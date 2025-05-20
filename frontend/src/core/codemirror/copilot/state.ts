/* Copyright 2024 Marimo. All rights reserved. */
import {
  getResolvedMarimoConfig,
  resolvedMarimoConfigAtom,
} from "@/core/config/config";
import { store, waitFor } from "@/core/state/jotai";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const KEY = "marimo:copilot:signedIn";

export const isGitHubCopilotSignedInState = atomWithStorage<boolean | null>(
  KEY,
  null,
  undefined,
  {
    getOnInit: true,
  },
);

// Represents the different stages of Copilot authentication and connection
export type CopilotAuthStatus =
  | "uninitialized" // Initial state before any action
  | "connecting" // LSP client is attempting to connect
  | "notConnected" // LSP client failed to connect (general, not auth related)
  | "signedOut" // User is not signed in, or explicitly signed out
  | "signingIn" // User has initiated sign-in, userCode is available
  | "signInFailed" // An attempt to sign in failed
  | "signedIn" // User is successfully signed in
  | "connectionError" // A connection error occurred during auth or operation
  | "error"; // A generic error state

export const copilotAuthStatusAtom = atom<CopilotAuthStatus>("uninitialized");

// Stores the user code received during the device flow
export const copilotUserCodeAtom = atom<string | null>(null);

// Stores the command to be executed after user authorizes in browser
export const copilotDeviceFlowCommandAtom = atom<object | null>(null);

// Stores any error messages related to Copilot authentication
export const copilotAuthErrorAtom = atom<string | null>(null);

// This atom is being replaced by copilotAuthStatusAtom for more detailed states
// but we keep the old name for now to minimize immediate breaking changes
// and will phase it out. For now, it can reflect a simplified status.
export const copilotSignedInState = atom<
  | "signedIn"
  | "signingIn"
  | "signInFailed"
  | "signedOut"
  | "connecting"
  | "connectionError"
  | "notConnected"
  | null
>(null);

export const githubCopilotLoadingVersion = atom<number | null>(null);

/**
 * Set the currently loading document version
 */
export function setGitHubCopilotLoadingVersion(version: number) {
  store.set(githubCopilotLoadingVersion, version);
}
/**
 * Clear the currently loading document version, if it matches the current version
 */
export function clearGitHubCopilotLoadingVersion(expectedVersion: number) {
  const currentVersion = store.get(githubCopilotLoadingVersion);
  if (currentVersion === expectedVersion) {
    store.set(githubCopilotLoadingVersion, null);
  }
}

function getIsLastSignedIn() {
  const lastSignedIn = localStorage.getItem(KEY);
  return lastSignedIn === "true";
}

export function isCopilotEnabled() {
  const copilot = getIsLastSignedIn();
  const userConfig = getResolvedMarimoConfig();
  return copilot && userConfig.completion.copilot === "github";
}

export function waitForEnabledCopilot() {
  return waitFor(resolvedMarimoConfigAtom, (value) => {
    return value.completion.copilot === "github";
  });
}
