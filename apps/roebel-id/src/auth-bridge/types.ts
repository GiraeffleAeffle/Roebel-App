export interface LoginRequest { message: string; signature: string }
export interface AuthBridge {
  issueNonce(): string
  verifyLogin(req: LoginRequest): Promise<{ address: string }>
}
