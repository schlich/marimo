/* Copyright 2024 Marimo. All rights reserved. */
import { invariant } from "@/utils/invariant";
import type { RuntimeConfig } from "./types";
import { Logger } from "@/utils/Logger";
import { getSessionId, type SessionId } from "../kernel/session";
import { KnownQueryParams } from "../constants";
import { Deferred } from "@/utils/Deferred";

export class RuntimeManager {
  private initialHealthyCheck = new Deferred<void>();

  constructor(
    private config: RuntimeConfig,
    private lazy = false,
  ) {
    // Validate the URL on construction
    try {
      new URL(this.config.url);
    } catch (error) {
      throw new Error(
        `Invalid runtime URL: ${this.config.url}. ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    if (!this.lazy) {
      this.init();
    }
  }

  get httpURL(): URL {
    return new URL(this.config.url);
  }

  get isSameOrigin(): boolean {
    return this.httpURL.origin === window.location.origin;
  }

  /**
   * The base URL of the runtime.
   */
  formatHttpURL(path?: string, searchParams?: URLSearchParams): URL {
    if (!path) {
      path = "";
    }
    // URL may be something like "http://localhost:8000?auth=123"
    const baseUrl = this.httpURL;
    const currentParams = new URLSearchParams(window.location.search);
    // Copy over search params if provided
    if (searchParams) {
      for (const [key, value] of searchParams.entries()) {
        baseUrl.searchParams.set(key, value);
      }
    }

    // Move over window level parameters to the WebSocket URL
    // if they are "known" query params.
    for (const lookup in KnownQueryParams) {
      const key = KnownQueryParams[lookup as keyof typeof KnownQueryParams];
      const value = currentParams.get(key);
      if (value !== null) {
        baseUrl.searchParams.set(key, value);
      }
    }

    const cleanPath = baseUrl.pathname.replace(/\/$/, "");
    baseUrl.pathname = `${cleanPath}/${path.replace(/^\//, "")}`;
    baseUrl.hash = "";
    return baseUrl;
  }

  formatWsURL(path: string, searchParams?: URLSearchParams): URL {
    const url = this.formatHttpURL(path, searchParams);
    return asWsUrl(url.toString());
  }

  /**
   * The WebSocket URL of the runtime.
   */
  getWsURL(sessionId: SessionId): URL {
    const baseUrl = new URL(this.config.url);
    const searchParams = new URLSearchParams(baseUrl.search);
    searchParams.set(KnownQueryParams.sessionId, sessionId);
    return this.formatWsURL("/ws", searchParams);
  }

  /**
   * The WebSocket Sync URL of the runtime, for real-time updates.
   */
  getWsSyncURL(sessionId: SessionId): URL {
    const baseUrl = new URL(this.config.url);
    const searchParams = new URLSearchParams(baseUrl.search);
    searchParams.set(KnownQueryParams.sessionId, sessionId);
    return this.formatWsURL("/ws_sync", searchParams);
  }

  /**
   * The WebSocket URL of the terminal.
   */
  getTerminalWsURL(): URL {
    return this.formatWsURL("/terminal/ws");
  }

  /**
   * The URL of the copilot server.
   */
  getLSPURL(lsp: "pylsp" | "copilot"): URL {
    return this.formatWsURL(`/lsp/${lsp}`);
  }

  getAiURL(path: "completion" | "chat"): URL {
    return this.formatHttpURL(`/api/ai/${path}`);
  }

  /**
   * The URL of the health check endpoint.
   */
  healthURL(): URL {
    return this.formatHttpURL("/health");
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(this.healthURL().toString());
      return response.ok;
    } catch {
      return false;
    }
  }

  async init(options?: {
    disableRetryDelay?: boolean;
  }) {
    let retries = 0;
    const maxRetries = 6;
    const baseDelay = 1000;

    while (!(await this.isHealthy())) {
      if (retries >= maxRetries) {
        Logger.error(`Failed to connect after ${maxRetries} retries`);
        this.initialHealthyCheck.reject(
          new Error(`Failed to connect after ${maxRetries} retries`),
        );
        return;
      }
      if (!options?.disableRetryDelay) {
        const delay = baseDelay * 2 ** retries;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      retries++;
    }

    this.initialHealthyCheck.resolve();
  }

  /**
   * Wait for the runtime to be healthy.
   */
  async waitForHealthy(): Promise<void> {
    return this.initialHealthyCheck.promise;
  }

  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Marimo-Session-Id": getSessionId(),
      "Marimo-Server-Token": this.config.serverToken ?? "",
    };

    if (this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }

    return headers;
  }
}

function asWsUrl(url: string): URL {
  invariant(url.startsWith("http"), "URL must start with http");
  // Replace the protocol http with ws
  return new URL(url.replace(/^http/, "ws"));
}
