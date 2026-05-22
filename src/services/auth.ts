// src/services/auth.ts

export class AuthMiddleware {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("SERVER_API_KEY is required");
    this.apiKey = apiKey;
  }

  authenticate(req: Request): Response | null {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return this.unauthorized("Missing Authorization header");
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return this.unauthorized("Invalid Authorization format. Use: Bearer <key>");
    }
    if (parts[1] !== this.apiKey) {
      return this.unauthorized("Invalid API key");
    }
    return null;
  }

  private unauthorized(message: string): Response {
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
