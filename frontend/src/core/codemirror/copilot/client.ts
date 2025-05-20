/* Copyright 2024 Marimo. All rights reserved. */
import { once } from "@/utils/once";
import { languageServerWithClient } from "@marimo-team/codemirror-languageserver";
import { CopilotLanguageServerClient } from "./language-server";
import { WebSocketTransport } from "@open-rpc/client-js";
import { Transport } from "@open-rpc/client-js/build/transports/Transport";
import type { JSONRPCRequestData } from "@open-rpc/client-js/build/Request";
import {
  CopilotAuthStatus,
  copilotAuthErrorAtom,
  copilotAuthStatusAtom,
  copilotDeviceFlowCommandAtom,
  copilotUserCodeAtom,
  waitForEnabledCopilot,
} from "./state";
import { waitForWs } from "@/utils/waitForWs";
import { resolveToWsUrl } from "@/core/websocket/createWsUrl";
import { store } from "@/core/state/jotai";
import { Logger } from "@/utils/Logger";
import { toast } from "@/components/ui/use-toast";

// Dummy file for the copilot language server
export const COPILOT_FILENAME = "/__marimo_copilot__.py";
export const LANGUAGE_ID = "copilot";
const FILE_URI = `file://${COPILOT_FILENAME}`;

// Marimo editor information for LSP initialization
const EDITOR_INFO = {
  name: "Marimo Editor",
  version: "0.1.0", // Replace with actual Marimo version if available dynamically
};
const EDITOR_PLUGIN_INFO = {
  name: "Marimo GitHub Copilot Integration",
  version: "0.1.0", // Replace with actual plugin version
};

export const createWSTransport = once(() => {
  return new LazyWebsocketTransport();
});

/**
 * Custom WSTransport that:
 *  - waits for copilot to be enabled
 *  - wait for the websocket to be available
 */
class LazyWebsocketTransport extends Transport {
  private delegate: WebSocketTransport | undefined;
  private readonly WS_URL = resolveToWsUrl("lsp/copilot");

  constructor() {
    super();
    this.delegate = undefined;
  }

  private async tryConnect(retries = 3, delayMs = 1000): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create delegate, if it doesn't exist
        if (!this.delegate) {
          this.delegate = new WebSocketTransport(this.WS_URL);
          this.delegate.on("open", () => {
            store.set(copilotAuthStatusAtom, "connecting");
          });
          this.delegate.on("close", () => {
            // Only set to notConnected if not already in a signed-in/out state
            // to avoid overriding specific auth statuses on disconnect.
            const currentStatus = store.get(copilotAuthStatusAtom);
            if (
              currentStatus !== "signedIn" &&
              currentStatus !== "signedOut" &&
              currentStatus !== "signInFailed"
            ) {
              store.set(copilotAuthStatusAtom, "notConnected");
            }
          });
          this.delegate.on("error", (error) => {
            Logger.error("Copilot WebSocket error:", error);
            store.set(copilotAuthErrorAtom, "WebSocket connection error.");
            // Similar logic to 'close', don't override specific auth states.
            const currentStatus = store.get(copilotAuthStatusAtom);
            if (
              currentStatus !== "signedIn" &&
              currentStatus !== "signedOut" &&
              currentStatus !== "signInFailed"
            ) {
              store.set(copilotAuthStatusAtom, "connectionError");
            }
          });
        }
        await this.delegate.connect();
        Logger.log("Copilot#connect: Connected successfully");
        // Initial status after successful WebSocket connection,
        // before LSP initialization and auth checks.
        // The LSP server might send a status update quickly after this.
        store.set(copilotAuthStatusAtom, "connecting");
        return;
      } catch (error) {
        Logger.warn(
          `Copilot#connect: Connection attempt ${attempt}/${retries} failed`,
          error,
        );
        if (attempt === retries) {
          this.delegate = undefined;
          store.set(copilotAuthStatusAtom, "notConnected");
          store.set(
            copilotAuthErrorAtom,
            "Failed to connect to Copilot server after multiple retries.",
          );
          // Show error toast on final retry
          toast({
            variant: "danger",
            title: "GitHub Copilot Connection Error",
            description:
              "Failed to connect to GitHub Copilot. Please check settings and try again.",
          });
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  override async connect() {
    // Wait for copilot to be enabled
    await waitForEnabledCopilot();
    // Wait for ws to be available with retries
    await waitForWs(this.WS_URL, 3);
    store.set(copilotAuthStatusAtom, "connecting");
    // Try connecting with retries
    return this.tryConnect();
  }

  override close() {
    this.delegate?.close();
    this.delegate = undefined;
    // Reflect that we are no longer connected, but preserve auth state if signed in/out.
    const currentStatus = store.get(copilotAuthStatusAtom);
    if (currentStatus !== "signedIn" && currentStatus !== "signedOut") {
      store.set(copilotAuthStatusAtom, "notConnected");
    }
  }

  override async sendData(
    data: JSONRPCRequestData,
    timeout: number | null | undefined,
  ) {
    // Clamp timeout to 5 seconds
    timeout = Math.min(timeout ?? 5000, 5000);
    return this.delegate?.sendData(data, timeout);
  }
}

export const getCopilotClient = once(
  () =>
    new CopilotLanguageServerClient({
      rootUri: FILE_URI,
      workspaceFolders: null,
      transport: createWSTransport(),
      initializationOptions: {
        editorInfo: EDITOR_INFO,
        editorPluginInfo: EDITOR_PLUGIN_INFO,
      },
    }),
);

const client = getCopilotClient();

// Register handlers for LSP notifications
client.onNotification("didChangeStatus", (params: { status: CopilotAuthStatus; message?: string }) => {
  Logger.log("Copilot status changed:", params);
  store.set(copilotAuthStatusAtom, params.status);
  if (params.message) {
    // May want a separate atom for status messages vs auth errors
    store.set(copilotAuthErrorAtom, params.message);
  }
  // If status is error or inactive, but was previously signed in, update UI.
  if (params.status === "Error" || params.status === "Inactive") {
    // Assuming 'Error' and 'Inactive' map to our 'error' or 'signInFailed'
    // The server docs use 'Normal', 'Error', 'Warning', 'Inactive'
    // We map 'Normal' to 'signedIn' if appropriate conditions met (e.g. after successful sign in)
    // 'Error' could mean various things, might need more specific handling.
    const currentStatus = store.get(copilotAuthStatusAtom);
    if (currentStatus === "signedIn") {
       store.set(copilotAuthStatusAtom, "error"); // Or a more specific error state
    }
  } else if (params.status === "Normal") {
    // "Normal" might mean ready, but not necessarily "signedIn".
    // We'll rely on signIn calls to confirm "signedIn" status.
    // If already "signingIn", this "Normal" might indicate readiness for confirmSignIn.
    const currentAuthStatus = store.get(copilotAuthStatusAtom);
    if (currentAuthStatus === "uninitialized" || currentAuthStatus === "connecting" || currentAuthStatus === "signedOut") {
      // It's ready, but we haven't initiated sign-in yet, or user is signed out.
      // Could check if already signed in (e.g. from previous session)
      // client.checkStatus().then(status => if (status.signedIn) store.set(copilotAuthStatusAtom, "signedIn"))
      // For now, we assume 'signedOut' or 'uninitialized' until signIn is called.
      // If we were 'connecting', this means the LSP is ready.
       if (currentAuthStatus === "connecting") {
         // Check if we were previously signed in (e.g. token still valid)
         // This part is speculative as server docs don't detail auto-sign-in on connect.
         // Let's assume for now we always start as 'signedOut' from LSP perspective until explicit signIn.
         store.set(copilotAuthStatusAtom, "signedOut");
       }
    }
  }
});

client.onNotification("window/logMessage", (params) => {
  Logger.log("Copilot LSP log:", params);
});

client.onNotification("window/showMessage", (params) => {
  Logger.log("Copilot LSP message:", params);
  // Potentially update UI or show toast based on params.type (Error, Warning, Info)
  // For example, if it's an error message related to auth, update authErrorAtom.
  if (params.type === 1) { // Error type
    store.set(copilotAuthErrorAtom, params.message);
  }
});

client.onRequest("window/showMessageRequest", (params) => {
  Logger.log("Copilot LSP message request:", params);
  // These might require user interaction, e.g., showing a modal.
  // For auth, this could be used by the server, but the primary flow is device auth.
  return null; // Must reply to requests
});

export async function initiateSignInLsp() {
  try {
    store.set(copilotAuthStatusAtom, "signingIn");
    store.set(copilotUserCodeAtom, null);
    store.set(copilotDeviceFlowCommandAtom, null);
    store.set(copilotAuthErrorAtom, null);

    // Ensure client is connected before sending request
    // The transport handles actual connection logic.
    // await client.open(); // Assuming open is handled by transport or client internally

    const result = await client.sendRequest("signIn", {});
    Logger.log("Copilot signIn result:", result);

    if (result && result.userCode && result.command) {
      store.set(copilotUserCodeAtom, result.userCode);
      store.set(copilotDeviceFlowCommandAtom, result.command);
      // Status remains 'signingIn' until user confirms in browser and we call confirmSignInLsp
    } else {
      store.set(copilotAuthStatusAtom, "signInFailed");
      store.set(copilotAuthErrorAtom, "Sign-in initiation failed: Invalid response from server.");
      Logger.error("Copilot signIn failed: Invalid response", result);
    }
    return result;
  } catch (error) {
    Logger.error("Copilot signIn error:", error);
    store.set(copilotAuthStatusAtom, "signInFailed");
    store.set(copilotAuthErrorAtom, `Sign-in initiation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    return { error };
  }
}

export async function confirmSignInLsp() {
  const command = store.get(copilotDeviceFlowCommandAtom);
  if (!command) {
    Logger.error("Copilot confirmSignIn: No device flow command stored.");
    store.set(copilotAuthStatusAtom, "signInFailed");
    store.set(copilotAuthErrorAtom, "Sign-in confirmation failed: Missing device flow command.");
    return { error: "Missing device flow command" };
  }

  try {
    // The `workspace/executeCommand` might trigger the browser opening via `window/showDocument` on server-side.
    // The response to `workspace/executeCommand` for this flow is not detailed in server docs,
    // so we rely on `didChangeStatus` notifications to confirm sign-in success.
    await client.sendRequest("workspace/executeCommand", command);
    Logger.log("Copilot workspace/executeCommand (for signInConfirm) sent.");
    // At this point, we wait for a `didChangeStatus` notification that indicates signedIn.
    // If the server does not send a status update promptly, we might need a timeout or manual check.
    // For now, UI will show "Signing in..." and wait for status update.
    // Potentially, the signInConfirm call itself could return status if `executeCommand` is synchronous for this.
    // Let's assume for now it's async and status notification is the trigger.
  } catch (error) {
    Logger.error("Copilot confirmSignIn (executeCommand) error:", error);
    store.set(copilotAuthStatusAtom, "signInFailed");
    store.set(copilotAuthErrorAtom, `Sign-in confirmation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    return { error };
  }
  return {};
}

export async function signOutLsp() {
  try {
    await client.sendRequest("signOut", {});
    Logger.log("Copilot signOut successful");
    store.set(copilotAuthStatusAtom, "signedOut");
    store.set(copilotUserCodeAtom, null);
    store.set(copilotDeviceFlowCommandAtom, null);
    store.set(copilotAuthErrorAtom, null);
  } catch (error) {
    Logger.error("Copilot signOut error:", error);
    // Even if sign-out fails on server, reflect locally as signed out.
    store.set(copilotAuthStatusAtom, "signedOut");
    // Optionally, set an error message if needed for UI.
    // store.set(copilotAuthErrorAtom, `Sign-out failed: ${error.message}`);
  }
}

export function copilotServer() {
  return languageServerWithClient({
    documentUri: FILE_URI,
    client: getCopilotClient(),
    languageId: LANGUAGE_ID,
    // Disable all basic LSP features
    // we only need textDocument/didChange
    hoverEnabled: false,
    completionEnabled: false,
    definitionEnabled: false,
    renameEnabled: false,
    codeActionsEnabled: false,
    signatureHelpEnabled: false,
    diagnosticsEnabled: false,
  });
}
