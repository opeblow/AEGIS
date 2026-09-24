param(
  [string]$Base = "http://localhost:4000/api/v1",
  [string]$AiBase = "http://127.0.0.1:8555"
)

$Tmp = "C:\Users\USER\Documents\AEGIS\backend\.e2e-work"
if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
New-Item -ItemType Directory -Path $Tmp | Out-Null

$Curl = "C:\Windows\System32\curl.exe"

class Resp {
  [int]$Status
  [string]$Body
  [string]$Url
  [string]$Method
}

function Call {
  param(
    [string]$Method,
    [string]$Path,
    $Body,
    [string]$CookieJar,
    [string[]]$Headers,
    [string]$OutFile,
    [string[]]$Multipart
  )
  $uri = "$Base$Path"
  if ($Path -like "$AiBase*") { $uri = $Path }
  $args = @("-s","-S","-w","__STATUS__:%{http_code}")
  if ($CookieJar) { $args += @("-b",$CookieJar,"-c",$CookieJar) }
  if ($Method -ne "GET") { $args += @("-X",$Method) }
  foreach ($h in $Headers) { $args += @("-H",$h) }
  if ($Body -ne $null -and -not $Multipart) {
    $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 30 -Compress }
    $tmpBody = Join-Path $script:Tmp ("body-{0}.json" -f (Get-Random))
    Set-Content -Path $tmpBody -Value $json -NoNewline -Encoding ascii
    $args += @("-H","Content-Type: application/json","--data","@$tmpBody")
  }
  if ($Multipart) {
    foreach ($m in $Multipart) { $args += @("-F",$m) }
  }
  if ($OutFile) { $args += @("-o",$OutFile) }
  $args += @($uri)
  $out = & $Curl @args 2>&1
  $raw = $out -join "`n"
  $status = 0
  if ($raw -match "__STATUS__:(\d+)") { $status = [int]$matches[1] }
  $bodyText = $raw -replace "__STATUS__:\d+\s*$",""
  return [Resp]@{ Status=$status; Body=$bodyText; Url=$uri; Method=$Method }
}

function Log([string]$m){ Write-Host "  $m" }
function Step { param([string]$id,[string]$m,[string]$p,[int]$exp,[string]$note=""); Write-Host ("`n===== STEP $id : $m $p (expect ~$exp) $note =====") -ForegroundColor Cyan }
function Show([Resp]$r,[int]$n=0) { Write-Host ("  HTTP "+$r.Status) -ForegroundColor $(if($r.Status -ge 400){"Yellow"}else{"Green"}); if ($r.Body -and $n -gt 0){ $s=$r.Body.Substring(0,[Math]::Min($n,$r.Body.Length)); Write-Host ("  body: "+$s) } elseif ($r.Body){ Write-Host ("  body: "+$r.Body.Substring(0,[Math]::Min(400,$r.Body.Length))) } }

# ===== 1. Health =====
Step "H1" "GET" "/health" 200 "liveness"
$r1 = Call "GET" "/health"; Show $r1 400
Step "H2" "GET" "/health/ready" 200 "readiness (DB)"
$r2 = Call "GET" "/health/ready"; Show $r2 400

Step "AI-H" "GET" "$AiBase/health" 200 "ai-ml service health"
$ai = Call "GET" "$AiBase/health" -Headers @("Accept: application/json"); Show $ai 400

# ===== 2. Register user A =====
$uA = "aegis-a-$((Get-Random).ToString())@e2e.test"
$pwd = "TestPassword!2026"
Step "R1" "POST" "/auth/register" 201 "register user A"
$rb = Call "POST" "/auth/register" -Body @{ email=$uA; password=$pwd }; Show $rb 400
$uaId = $null
try { $uaId = ($rb.body | ConvertFrom-Json -ErrorAction Stop).user.id } catch {}
Write-Host "  A user id: $uaId"

function Log([string]$m){ Write-Host "  $m" }

# dev mailbox
Step "MA1" "GET" "/auth/dev/mailbox/tokens" 200 "dev mailbox (verification token for A)"
$mb = Call "GET" "/auth/dev/mailbox/tokens"; Show $mb 600
$verifyTokA = $null
try {
  $arr = $mb.body | ConvertFrom-Json -ErrorAction Stop
  $v = $arr.messages | Where-Object { $_.kind -eq "EMAIL_VERIFICATION" -and $_.to -eq $uA } | Select-Object -First 1
  if ($v) { $verifyTokA = $v.token }
} catch {}
Write-Host "  A verify token: $(if($verifyTokA){'set'}else{'MISSING'})"

Step "V1" "POST" "/auth/verify-email" 200 "verify A email"
$vb = Call "POST" "/auth/verify-email" -Body @{ token = $verifyTokA }; Show $vb 300

# login A
Step "L1" "POST" "/auth/login" 200 "login A, capture session+csrf cookies"
$jarA = "$Tmp\jarA.txt"
$lr = Call "POST" "/auth/login" -Body @{ email=$uA; password=$pwd } -CookieJar $jarA; Show $lr 400
$csrfA = $null
try { $csrfA = ($lr.body | ConvertFrom-Json -ErrorAction Stop).csrfToken } catch {}
Write-Host "  csrf A set: $(if($csrfA){$true})  jar exists: $(Test-Path $jarA)"

Step "M1" "GET" "/auth/me" 200 "authenticated endpoint w/ session cookie"
$me = Call "GET" "/auth/me" -CookieJar $jarA; Show $me 400

# ===== 3. Organization =====
$orgAName = "AlphaCorp-$((Get-Random).ToString())"
Step "O1" "POST" "/organizations" 201 "create org A (owner=A -> OWNER)"
$ob = Call "POST" "/organizations" -Body @{ name=$orgAName; slug="alpha-$((Get-Random).ToString())" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $ob 500
$orgAId = $null
try { $orgAId = ($ob.body | ConvertFrom-Json).organization.id } catch {}
Write-Host "  orgA id: $orgAId"

Step "O2" "GET" "/organizations" 200 "list orgs for A"
$ols = Call "GET" "/organizations" -CookieJar $jarA; Show $ols 300

Step "O3" "GET" "/organizations/$orgAId" 200 "get org A"
$og = Call "GET" "/organizations/$orgAId" -CookieJar $jarA; Show $og 400

Step "O4" "GET" "/organizations/$orgAId/roles" 200 "roles + permissions"
$rg = Call "GET" "/organizations/$orgAId/roles" -CookieJar $jarA; Show $rg 700

# Register B, C, D
$uB = "aegis-b-$((Get-Random).ToString())@e2e.test"
$uD = "aegis-d-$((Get-Random).ToString())@e2e.test"
$uC = "aegis-c-$((Get-Random).ToString())@e2e.test"
Step "R2" "POST" "/auth/register" 201 "register user B"
Call "POST" "/auth/register" -Body @{ email=$uB; password=$pwd } | Out-Null
Step "R3" "POST" "/auth/register" 201 "register user C (outsider)"
Call "POST" "/auth/register" -Body @{ email=$uC; password=$pwd } | Out-Null
Step "R4" "POST" "/auth/register" 201 "register user D (will be MEMBER of org A)"
Call "POST" "/auth/register" -Body @{ email=$uD; password=$pwd } | Out-Null

# verify B, C, D
foreach ($pair in @(@{u=$uB;n="B"},@{u=$uC;n="C"},@{u=$uD;n="D"})) {
  Step ("V-"+$pair.n) "POST" "/auth/verify-email" 200 "verify $($pair.n) email"
  $mb2 = Call "GET" "/auth/dev/mailbox/tokens"
  $tok = $null
  try {
    $arr2 = $mb2.body | ConvertFrom-Json -ErrorAction SilentlyContinue
    $v2 = $arr2.messages | Where-Object { $_.kind -eq "EMAIL_VERIFICATION" -and $_.to -eq $pair.u } | Select-Object -First 1
    if ($v2) { $tok = $v2.token }
  } catch {}
  Call "POST" "/auth/verify-email" -Body @{ token = $tok } | Out-Null
}

# login B, create org B
Step "L2" "POST" "/auth/login" 200 "login B"
$lrB = Call "POST" "/auth/login" -Body @{ email=$uB; password=$pwd } -CookieJar "$Tmp\jarB.txt"; Show $lrB 200
$csrfB = $null
try { $csrfB = ($lrB.body | ConvertFrom-Json -ErrorAction Stop).csrfToken } catch {}
Step "O5" "POST" "/organizations" 201 "create org B by user B"
$obB = Call "POST" "/organizations" -Body @{ name="BetaCo-$((Get-Random).ToString())"; slug="beta-$((Get-Random).ToString())" } -CookieJar "$Tmp\jarB.txt" -Headers @("x-csrf-token: $csrfB"); Show $obB 400
$orgBId = $null
try { $orgBId = ($obB.body | ConvertFrom-Json).organization.id } catch {}
Write-Host "  orgB id: $orgBId"

# login C, create org C (outsider)
$lrC = Call "POST" "/auth/login" -Body @{ email=$uC; password=$pwd } -CookieJar "$Tmp\jarC.txt"
$csrfC = $null; try { $csrfC = ($lrC.body | ConvertFrom-Json -ErrorAction Stop).csrfToken } catch {}
Step "O6" "POST" "/organizations" 201 "create org C by user C (outsider)"
$obC = Call "POST" "/organizations" -Body @{ name="GammaCo-$((Get-Random).ToString())"; slug="gamma-$((Get-Random).ToString())" } -CookieJar "$Tmp\jarC.txt" -Headers @("x-csrf-token: $csrfC"); Show $obC 300
$orgCId = $null; try { $orgCId = ($obC.body | ConvertFrom-Json).organization.id } catch {}
Write-Host "  orgC id: $orgCId"

# login D
$lrD = Call "POST" "/auth/login" -Body @{ email=$uD; password=$pwd } -CookieJar "$Tmp\jarD.txt"
$csrfD = $null; try { $csrfD = ($lrD.body | ConvertFrom-Json -ErrorAction Stop).csrfToken } catch {}

# invite D to org A as MEMBER
Step "O7" "POST" "/organizations/$orgAId/invitations" 201 "owner A invites D as MEMBER into org A"
$inv = Call "POST" "/organizations/$orgAId/invitations" -Body @{ email=$uD; role="MEMBER" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $inv 300

# D accepts org invite
$mb3 = Call "GET" "/auth/dev/mailbox/tokens"
$orgTokD = $null
try {
  $arr3 = $mb3.body | ConvertFrom-Json -ErrorAction SilentlyContinue
  $v3 = $arr3.messages | Where-Object { $_.kind -eq "ORGANIZATION_INVITATION" -and $_.to -eq $uD } | Select-Object -First 1
  if ($v3) { $orgTokD = $v3.token }
} catch {}
Step "O8" "POST" "/invitations/$orgTokD/accept" 201 "D accepts org A membership"
$acc = Call "POST" "/invitations/$orgTokD/accept" -Body @{} -CookieJar "$Tmp\jarD.txt" -Headers @("x-csrf-token: $csrfD"); Show $acc 300

Step "M2" "GET" "/auth/me" 200 "D session valid"
Call "GET" "/auth/me" -CookieJar "$Tmp\jarD.txt" | Out-Null
Write-Host "  D is now MEMBER of org A"

# ===== 4. Deal lifecycle =====
$set = (Get-Date).ToUniversalTime().AddDays(90).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$exp = (Get-Date).ToUniversalTime().AddDays(30).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
Step "D1" "POST" "/organizations/$orgAId/deals" 201 "create deal (DRAFT)"
$db = Call "POST" "/organizations/$orgAId/deals" -Body @{ type="PRIVATE_TRADE"; name="E2E Cross-Currency Swap"; description="Live E2E test deal for Phase 9 intelligence"; currency="USD"; notionalAmount="5000000.00"; settlementDate=$set; expiresAt=$exp; reference="E2E-001" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $db 600
$dealId = $null
try { $dealId = ($db.body | ConvertFrom-Json).deal.id } catch {}
Write-Host "  dealId: $dealId"
# capture deal version for transitions
$dver = $null
try { $dver = ($db.body | ConvertFrom-Json).deal.version } catch {}

Step "D2" "GET" "/organizations/$orgAId/deals/$dealId" 200 "retrieve deal"
$dg = Call "GET" "/organizations/$orgAId/deals/$dealId" -CookieJar $jarA; Show $dg 500

Step "D3" "GET" "/organizations/$orgAId/deals" 200 "list deals"
Call "GET" "/organizations/$orgAId/deals" -CookieJar $jarA | Out-Null

Step "D4" "GET" "/organizations/$orgAId/deals/$dealId/history" 200 "deal history"
Call "GET" "/organizations/$orgAId/deals/$dealId/history" -CookieJar $jarA | Out-Null

Step "D5" "POST" "/organizations/$orgAId/deals/$dealId/transitions" 200 "DRAFT->OPEN"
$tr = Call "POST" "/organizations/$orgAId/deals/$dealId/transitions" -Body @{ toStatus="OPEN"; reason="Opened to counterparty for negotiation."; version=$dver; requestId="e2e-open-$((Get-Random).ToString())" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $tr 400

# ===== 5. Counterparty + invite B =====
Step "C1" "POST" "/organizations/$orgAId/counterparties" 201 "create counterparty A->B"
$cp = Call "POST" "/organizations/$orgAId/counterparties" -Body @{ counterpartyOrganizationId=$orgBId } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $cp 500
$cpId = $null; try { $cpId = ($cp.body | ConvertFrom-Json).counterparty.id } catch {}
Write-Host "  cpId: $cpId"

Step "C2" "PATCH" "/organizations/$orgAId/counterparties/$cpId" 200 "activate + verify counterparty"
Call "PATCH" "/organizations/$orgAId/counterparties/$cpId" -Body @{ status="ACTIVE"; verificationStatus="VERIFIED" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA") | Out-Null

Step "C3" "GET" "/organizations/$orgAId/counterparties" 200 "list counterparties"
Call "GET" "/organizations/$orgAId/counterparties" -CookieJar $jarA | Out-Null

Step "C4" "POST" "/deals/$dealId/invitations" 201 "invite B to deal"
$di = Call "POST" "/deals/$dealId/invitations" -Body @{ organizationId=$orgBId; email=$uB; participantType="COUNTERPARTY" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $di 300

$mb4 = Call "GET" "/auth/dev/mailbox/tokens"
$dealTok = $null
try {
  $arr4 = $mb4.body | ConvertFrom-Json -ErrorAction SilentlyContinue
  $v4 = $arr4.messages | Where-Object { $_.kind -eq "DEAL_PARTICIPANT_INVITATION" -and $_.to -eq $uB } | Select-Object -First 1
  if ($v4) { $dealTok = $v4.token }
} catch {}

Step "C5" "POST" "/deal-invitations/$dealTok/accept" 201 "B accepts deal invitation"
$acc2 = Call "POST" "/deal-invitations/$dealTok/accept" -Body @{} -CookieJar "$Tmp\jarB.txt" -Headers @("x-csrf-token: $csrfB"); Show $acc2 400

Step "C6" "GET" "/deals/$dealId/participants" 200 "list participants (owner sees both)"
$ps = Call "GET" "/deals/$dealId/participants" -CookieJar $jarA; Show $ps 300

Step "C6b" "GET" "/deals/$dealId/room" 200 "deal room"
Call "GET" "/deals/$dealId/room" -CookieJar $jarA | Out-Null

# ===== 6. Phase 9 Intelligence =====
Step "I1" "POST" "/deals/$dealId/intelligence/analyze" 200 "analyze (owner A, has intelligence:analyze)"
$an = Call "POST" "/deals/$dealId/intelligence/analyze" -Body @{} -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $an 900
$runId = $null
try { $runId = ($an.body | ConvertFrom-Json).run.id } catch {}
Write-Host "  *** runId: $runId"
try {
  $rj = $an.body | ConvertFrom-Json -ErrorAction Stop
  Write-Host "  replayed: $($rj.replayed)  status: $($rj.run.status)"
  Write-Host "  provider: $(if($rj.run.provider){$rj.run.provider})  modelVersion: $(if($rj.run.modelVersion){$rj.run.modelVersion})  analysisVersion: $(if($rj.run.analysisVersion){$rj.run.analysisVersion})"
  Write-Host "  confidenceSummary: $(if($rj.run.confidenceSummary){$rj.run.confidenceSummary|ConvertTo-Json -Compress})"
  Write-Host "  result.deal_id: $(if($rj.run.result){$rj.run.result.deal_id})"
  Write-Host "  result.summary.model_summary: $(if($rj.run.result -and $rj.run.result.summary){$rj.run.result.summary.model_summary})"
} catch {}

Step "I2" "GET" "/deals/$dealId/intelligence" 200 "list runs"
$rl = Call "GET" "/deals/$dealId/intelligence" -CookieJar $jarA; Show $rl 600

Step "I3" "GET" "/deals/$dealId/intelligence/$runId" 200 "get run by id (owner)"
$rg = Call "GET" "/deals/$dealId/intelligence/$runId" -CookieJar $jarA; Show $rg 600

Step "I4" "POST" "/deals/$dealId/intelligence/query" 200 "query (in-scope)"
$iq = Call "POST" "/deals/$dealId/intelligence/query" -Body @{ question="What is the notional amount and currency of this deal?" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $iq 600

  Step "I5" "POST" "/deals/$dealId/intelligence/query" 200 "query (out-of-scope -> 200, within_scope=false)"
  $iq2 = Call "POST" "/deals/$dealId/intelligence/query" -Body @{ question="What is the meaning of life, the universe, and everything?" } -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $iq2 400
  try {
    $iqj = $iq2.body | ConvertFrom-Json -ErrorAction Stop
    Write-Host "  within_scope: $($iqj.answer.within_scope) (expect False)"
  } catch {}

Step "I6" "POST" "/deals/$dealId/intelligence/analyze" 200 "re-analyze (should REPLAY, same runId)"
$an2 = Call "POST" "/deals/$dealId/intelligence/analyze" -Body @{} -CookieJar $jarA -Headers @("x-csrf-token: $csrfA"); Show $an2 300
$runId2 = $null; $repl = $null
try { $rj2 = $an2.body|ConvertFrom-Json; $runId2=$rj2.run.id; $repl=$rj2.replayed } catch {}
Write-Host "  replayed=$repl runId=$runId2 (orig=$runId; match=$($runId2 -eq $runId))"

Step "RBAC-D-ANALYZE" "POST" "/deals/$dealId/intelligence/analyze" 403 "member D analyze -> 403 (no intelligence:analyze)"
$md = Call "POST" "/deals/$dealId/intelligence/analyze" -Body @{} -CookieJar "$Tmp\jarD.txt" -Headers @("x-csrf-token: $csrfD"); Show $md 300

Step "RBAC-D-READ" "GET" "/deals/$dealId/intelligence" 200 "member D list runs -> 200 (has intelligence:read)"
$mdr = Call "GET" "/deals/$dealId/intelligence" -CookieJar "$Tmp\jarD.txt"; Show $mdr 200
Step "RBAC-D-GET" "GET" "/deals/$dealId/intelligence/$runId" 200 "member D get run -> 200"
Call "GET" "/deals/$dealId/intelligence/$runId" -CookieJar "$Tmp\jarD.txt" | Out-Null
Step "RBAC-D-QUERY" "POST" "/deals/$dealId/intelligence/query" 403 "member D query -> 403 (no intelligence:analyze)"
$mdq = Call "POST" "/deals/$dealId/intelligence/query" -Body @{ question="What is the deal currency?" } -CookieJar "$Tmp\jarD.txt" -Headers @("x-csrf-token: $csrfD"); Show $mdq 200

Step "RBAC-B-ANALYZE" "POST" "/deals/$dealId/intelligence/analyze" 200 "counterparty B analyze (OWNER of org B -> has all perms)"
$bd = Call "POST" "/deals/$dealId/intelligence/analyze" -Body @{} -CookieJar "$Tmp\jarB.txt" -Headers @("x-csrf-token: $csrfB"); Show $bd 300
$runIdB = $null
try { $runIdB = ($bd.body | ConvertFrom-Json).run.id } catch {}
Write-Host "  B runId: $runIdB"

Step "RBAC-C-ANALYZE" "POST" "/deals/$dealId/intelligence/analyze" 404 "outsider C (org C not participant) -> 404"
$cd = Call "POST" "/deals/$dealId/intelligence/analyze" -Body @{} -CookieJar "$Tmp\jarC.txt" -Headers @("x-csrf-token: $csrfC"); Show $cd 300
Step "RBAC-C-LIST" "GET" "/deals/$dealId/intelligence" 404 "outsider C list -> 404"
Call "GET" "/deals/$dealId/intelligence" -CookieJar "$Tmp\jarC.txt" | Out-Null
Step "RBAC-C-GET" "GET" "/deals/$dealId/intelligence/$runId" 404 "outsider C get run -> 404"
Call "GET" "/deals/$dealId/intelligence/$runId" -CookieJar "$Tmp\jarC.txt" | Out-Null

"orgAId=$orgAId" | Set-Content "$Tmp\ids.txt"
"orgBId=$orgBId" | Add-Content "$Tmp\ids.txt"
"orgCId=$orgCId" | Add-Content "$Tmp\ids.txt"
"dealId=$dealId" | Add-Content "$Tmp\ids.txt"
"runId=$runId" | Add-Content "$Tmp\ids.txt"
"runIdB=$runIdB" | Add-Content "$Tmp\ids.txt"
"uA=$uA" | Add-Content "$Tmp\ids.txt"
"uB=$uB" | Add-Content "$Tmp\ids.txt"
"uC=$uC" | Add-Content "$Tmp\ids.txt"
"uD=$uD" | Add-Content "$Tmp\ids.txt"

Write-Host "`n==== HARNESS PHASE 1-6 DONE ====" -ForegroundColor Green
Write-Host "Artifacts: $Tmp"
