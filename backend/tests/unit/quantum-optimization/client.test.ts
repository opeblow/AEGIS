import { describe, expect, it, vi } from "vitest";
import { createQuantumClient } from "../../../src/modules/quantum/quantum.client.js";
import type { QuantumProblem } from "../../../src/modules/quantum/quantum.schemas.js";
import { AppError } from "../../../src/lib/errors/index.js";

function validProblem(): QuantumProblem {
  return {
    transaction_amount: "1250000.50",
    routes: [
      {
        id: "route-a",
        cost: 1,
        risk: 0.1,
        liquidity: 100,
        capacity: 100,
        available: true,
      },
    ],
    constraints: { min_selected_routes: 1 },
    objective_weights: { cost: 1, risk: 1, selection: 0 },
  };
}

function validSolverResult(overrides: Record<string, unknown> = {}) {
  return {
    problem_id: "problem-123",
    solver_type: "simulator",
    feasible: true,
    selected_variables: { x0: 1 },
    selected_routes: ["route-a"],
    allocations: [{ route_id: "route-a", amount: "1250000.50" }],
    objective_value: "98.5",
    energy: -12.3,
    constraint_violations: [],
    formulation_metadata: {
      formulation_type: "QUBO",
      num_binary_variables: 1,
      num_route_variables: 1,
      num_slack_variables: 0,
      num_constraints: 0,
      precision_scale: 6,
      penalty_coefficient: "100",
      constraint_encoding: "bounded binary slack registers",
    },
    execution_metadata: {
      backend: "qiskit",
      algorithm: "qaoa",
      deterministic: false,
      shots: 2048,
    },
    confidence: 0.9,
    ...overrides,
  };
}

function validComparison(overrides: Record<string, unknown> = {}) {
  return {
    problem_id: "problem-123",
    classical: validSolverResult({ solver_type: "classical" }),
    quantum: validSolverResult({ solver_type: "simulator" }),
    objective_delta: null,
    better_solver: "tie",
    same_feasibility: true,
    claim: "Both solvers returned the same observed objective; no advantage is claimed.",
    ...overrides,
  };
}

function mockFetchOnce(respond: () => Response) {
  return vi.fn(async () => respond());
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createQuantumClient", () => {
  it("parses a successful /optimize response", async () => {
    const fetchFn = mockFetchOnce(() => jsonResponse(200, validSolverResult()));
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    const { result, problemId } = await client.optimize({ problem: validProblem() });
    expect(result.problem_id).toBe("problem-123");
    expect(result.feasible).toBe(true);
    expect(problemId).toBe("problem-123");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe("http://quantum:8557/optimize");
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).problem.transaction_amount).toBe("1250000.50");
  });

  it("parses a successful /compare response", async () => {
    const fetchFn = mockFetchOnce(() => jsonResponse(200, validComparison()));
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    const { result, problemId } = await client.compare({
      problem: validProblem(),
      quantumSolver: "simulator",
    });
    expect(result.better_solver).toBe("tie");
    expect(problemId).toBe("problem-123");
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).quantum_solver).toBe("simulator");
  });

  it("sends the requested solver only when provided", async () => {
    const withSolver = vi.fn(async () => jsonResponse(200, validSolverResult()));
    const authed = createQuantumClient({ baseUrl: "http://q:8557", fetchFn: withSolver });
    await authed.optimize({ problem: validProblem(), solver: "real_hardware" });
    const init = withSolver.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).solver).toBe("real_hardware");

    const withoutSolver = vi.fn(async () => jsonResponse(200, validSolverResult()));
    const anon = createQuantumClient({ baseUrl: "http://q:8557", fetchFn: withoutSolver });
    await anon.optimize({ problem: validProblem() });
    const anonInit = withoutSolver.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(anonInit.body as string).solver).toBeUndefined();
  });

  it("accepts decimal fields arriving as numbers (FastAPI float serialization)", async () => {
    const result = validSolverResult({
      objective_value: 98.5,
      allocations: [{ route_id: "route-a", amount: 1250000.5 }],
    });
    const fetchFn = mockFetchOnce(() => jsonResponse(200, result));
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    const { result: parsed } = await client.optimize({ problem: validProblem() });
    expect(parsed.objective_value).toBe(98.5);
  });

  it("rejects a result missing required fields", async () => {
    const { feasible: _drop, ...missing } = validSolverResult();
    void _drop;
    const fetchFn = mockFetchOnce(() => jsonResponse(200, missing));
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    await expect(client.optimize({ problem: validProblem() })).rejects.toMatchObject({
      code: "QUANTUM_INVALID_RESPONSE",
    });
  });

  it("rejects an invalid better_solver value in a comparison", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(200, validComparison({ better_solver: "magic" })),
    );
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    await expect(
      client.compare({ problem: validProblem() }),
    ).rejects.toMatchObject({ code: "QUANTUM_INVALID_RESPONSE" });
  });

  it("maps each upstream HTTP status to its stable code", async () => {
    const cases: Array<[number, string]> = [
      [401, "QUANTUM_SERVICE_UNAUTHORIZED"],
      [413, "QUANTUM_INPUT_TOO_LARGE"],
      [422, "QUANTUM_PROBLEM_REJECTED"],
      [500, "QUANTUM_OPTIMIZATION_FAILED"],
      [502, "QUANTUM_SERVICE_UNAVAILABLE"],
      [503, "QUANTUM_SERVICE_UNAVAILABLE"],
      [504, "QUANTUM_SERVICE_TIMEOUT"],
      [501, "QUANTUM_SERVICE_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      const fetchFn = mockFetchOnce(() =>
        jsonResponse(status, { error: { code: "UPSTREAM", message: "boom" } }),
      );
      const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
      await expect(client.optimize({ problem: validProblem() })).rejects.toMatchObject({
        code,
      });
    }
  });

  it("keeps client-safe messages for upstream errors", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(500, { error: { code: "QUANTUM_INTERNAL_ERROR", message: "solver crashed" } }),
    );
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    const error = (await client
      .optimize({ problem: validProblem() })
      .catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("QUANTUM_OPTIMIZATION_FAILED");
    expect(error.message).not.toMatch(/solver crashed/);
  });

  it("maps a 422 upstream rejection to QUANTUM_PROBLEM_REJECTED without leaking details", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(422, {
        error: { code: "QUANTUM_PROBLEM_INVALID", message: "internal constraint hint" },
      }),
    );
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    const error = (await client
      .optimize({ problem: validProblem() })
      .catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("QUANTUM_PROBLEM_REJECTED");
    expect(error.message).not.toContain("internal constraint hint");
  });

  it("maps a non-JSON body to QUANTUM_INVALID_RESPONSE", async () => {
    const fetchFn = mockFetchOnce(() =>
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    await expect(client.optimize({ problem: validProblem() })).rejects.toMatchObject({
      code: "QUANTUM_INVALID_RESPONSE",
    });
  });

  it("maps an empty success body to QUANTUM_INVALID_RESPONSE", async () => {
    const fetchFn = mockFetchOnce(() => new Response("", { status: 200 }));
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    await expect(client.optimize({ problem: validProblem() })).rejects.toMatchObject({
      code: "QUANTUM_INVALID_RESPONSE",
    });
  });

  it("maps generic transport errors to QUANTUM_SERVICE_UNAVAILABLE", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    await expect(client.optimize({ problem: validProblem() })).rejects.toMatchObject({
      code: "QUANTUM_SERVICE_UNAVAILABLE",
    });
  });

  it("maps AbortError timeouts to QUANTUM_SERVICE_TIMEOUT", async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException("timed out", "AbortError");
    });
    const client = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn });
    await expect(client.optimize({ problem: validProblem() })).rejects.toMatchObject({
      code: "QUANTUM_SERVICE_TIMEOUT",
    });
  });

  it("sends a Bearer token only when configured", async () => {
    const withToken = vi.fn(async () => jsonResponse(200, validSolverResult()));
    const authed = createQuantumClient({ baseUrl: "http://quantum:8557", token: "tok-123", fetchFn: withToken });
    await authed.optimize({ problem: validProblem() });
    const authedInit = withToken.mock.calls[0][1] as RequestInit;
    expect(authedInit.headers).toMatchObject({ authorization: "Bearer tok-123" });

    const withoutToken = vi.fn(async () => jsonResponse(200, validSolverResult()));
    const anon = createQuantumClient({ baseUrl: "http://quantum:8557", fetchFn: withoutToken });
    await anon.optimize({ problem: validProblem() });
    const anonInit = withoutToken.mock.calls[0][1] as RequestInit;
    expect((anonInit.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetchFn = mockFetchOnce(() => jsonResponse(200, validSolverResult()));
    const client = createQuantumClient({ baseUrl: "http://quantum:8557///", fetchFn });
    await client.optimize({ problem: validProblem() });
    expect(String(fetchFn.mock.calls[0][0])).toBe("http://quantum:8557/optimize");
  });
});