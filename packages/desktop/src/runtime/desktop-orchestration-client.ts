import {
  AuthBootstrapInput,
  AuthBootstrapResult,
  ClientOrchestrationCommand,
  ClientOrchestrationCommand as ClientOrchestrationCommandSchema,
} from "@multi/contracts";
import { formatSchemaError, formatSchemaIssues } from "@multi/shared/schema-json";
import { Exit, Schema } from "effect";

const decodeBootstrapResult = Schema.decodeUnknownSync(AuthBootstrapResult);
const decodeDispatchCommand = Schema.decodeUnknownExit(ClientOrchestrationCommandSchema);

export interface DesktopOrchestrationClientConfig {
  readonly httpBaseUrl: URL;
  readonly bootstrapToken: string;
}

export class DesktopOrchestrationClient {
  private sessionToken: string | null = null;
  private config: DesktopOrchestrationClientConfig | null = null;

  async configure(config: DesktopOrchestrationClientConfig): Promise<void> {
    this.config = config;
    this.sessionToken = await exchangeBootstrapToken(config);
  }

  async dispatchCommand(command: ClientOrchestrationCommand): Promise<void> {
    const config = this.config;
    if (!config) {
      throw new Error("Desktop orchestration client is not configured.");
    }

    const decoded = decodeDispatchCommand(command, {
      errors: "all",
      propertyOrder: "original",
    });
    if (Exit.isFailure(decoded)) {
      throw new Error(
        `Runtime orchestration persistence command failed schema validation: ${formatSchemaError(decoded.cause)} (${formatSchemaIssues(decoded.cause)})`,
      );
    }

    const sessionToken = this.sessionToken ?? (await exchangeBootstrapToken(config));
    this.sessionToken = sessionToken;

    const response = await fetch(new URL("/api/orchestration/dispatch", config.httpBaseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(decoded.value),
    });

    if (response.status === 401) {
      this.sessionToken = await exchangeBootstrapToken(config);
      return this.dispatchCommand(command);
    }

    if (!response.ok) {
      const message = await readErrorMessage(
        response,
        `Failed to dispatch orchestration command (${response.status}).`,
      );
      throw new Error(message);
    }
  }

  reset(): void {
    this.sessionToken = null;
    this.config = null;
  }
}

async function exchangeBootstrapToken(config: DesktopOrchestrationClientConfig): Promise<string> {
  const payload: AuthBootstrapInput = { credential: config.bootstrapToken };
  const response = await fetch(new URL("/api/auth/bootstrap", config.httpBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `Failed to bootstrap desktop orchestration session (${response.status}).`,
    );
    throw new Error(message);
  }

  const body: unknown = await response.json();
  const result = decodeBootstrapResult(body);
  return result.sessionToken;
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const error = Reflect.get(parsed, "error");
      if (typeof error === "string" && error.trim().length > 0) {
        return error;
      }
      const message = Reflect.get(parsed, "message");
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }
  } catch {
    return text;
  }

  return fallbackMessage;
}

export function createDesktopOrchestrationClient(): DesktopOrchestrationClient {
  return new DesktopOrchestrationClient();
}
