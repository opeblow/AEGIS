import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { EMAIL_MAX_LENGTH } from "./user.service.js";
import { TOKEN_RAW_MAX_LENGTH } from "./tokens.js";

const env = getEnv();

export const passwordSchema = z
  .string()
  .min(env.AUTH_PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${env.AUTH_PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(env.AUTH_PASSWORD_MAX_LENGTH, {
    message: `Password must be at most ${env.AUTH_PASSWORD_MAX_LENGTH} characters.`,
  });

export const emailSchema = z
  .string()
  .trim()
  .min(3, { message: "Email must be at least 3 characters." })
  .max(EMAIL_MAX_LENGTH, { message: "Email is too long." })
  .email({ message: "Invalid email address." });

export const token256Schema = z
  .string()
  .trim()
  .min(1)
  .max(TOKEN_RAW_MAX_LENGTH);

export const uuidParamSchema = z.object({
  sessionId: z.string().trim().uuid({ message: "Invalid session id." }),
});

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: z.string().trim().min(1, { message: "Email is required." }),
  password: z.string().min(1, { message: "Password is required." }),
});

export const verifyEmailBodySchema = z.object({
  token: token256Schema,
});

export const resendVerificationBodySchema = z.object({
  email: emailSchema,
});

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const resetPasswordBodySchema = z.object({
  token: token256Schema,
  password: passwordSchema,
});

export const changePasswordBodySchema = z.object({
  currentPassword: z
    .string()
    .min(1, { message: "Current password is required." }),
  password: passwordSchema,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>;
export type ResendVerificationBody = z.infer<
  typeof resendVerificationBodySchema
>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
