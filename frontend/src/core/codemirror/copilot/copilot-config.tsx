/* Copyright 2024 Marimo. All rights reserved. */
import { useAtom } from "jotai";
import {
  copilotAuthStatusAtom,
  copilotUserCodeAtom,
  copilotAuthErrorAtom,
  // isGitHubCopilotSignedInState, // Keep if still used for global enable/disable logic elsewhere
} from "./state";
import { memo, useEffect, useState } from "react";
import {
  initiateSignInLsp,
  confirmSignInLsp,
  signOutLsp,
  getCopilotClient, // Keep if direct client interaction is still needed for non-auth parts
} from "./client";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckIcon, CopyIcon, Loader2Icon, AlertTriangleIcon, XIcon } from "lucide-react";
import { ExternalLink } from "@/components/ui/links";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { copyToClipboard } from "@/utils/copy";
import { Logger } from "@/utils/Logger";
import { useOpenSettingsToTab } from "@/components/app-config/state";

export const CopilotConfig = memo(() => {
  const [authStatus, setAuthStatus] = useAtom(copilotAuthStatusAtom);
  const [userCode, setUserCode] = useAtom(copilotUserCodeAtom);
  const [authError, setAuthError] = useAtom(copilotAuthErrorAtom);

  // Used to store verification URI from initiateSignInLsp response
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { handleClick: openSettings } = useOpenSettingsToTab();

  // Effect to clear userCode and verificationUri when authStatus changes from "signingIn"
  useEffect(() => {
    if (authStatus !== "signingIn") {
      setUserCode(null);
      setVerificationUri(null);
    }
    if (authStatus !== "signInFailed" && authStatus !== "error" && authStatus !== "connectionError") {
      setAuthError(null);
    }
  }, [authStatus, setUserCode, setVerificationUri, setAuthError]);


  const handleSignIn = async (evt: React.MouseEvent) => {
    evt.preventDefault();
    setLoading(true);
    setAuthError(null); // Clear previous errors
    try {
      // initiateSignInLsp now updates global state atoms for userCode and deviceFlowCommand
      // It should return the verificationUri and potentially initial status.
      const result = await initiateSignInLsp();
      if (result && result.userCode && result.verificationUri) {
        setVerificationUri(result.verificationUri);
        // userCode is set via copilotUserCodeAtom by initiateSignInLsp
        // authStatus is set to "signingIn" by initiateSignInLsp
      } else if (result && result.error) {
        // Error state already set by initiateSignInLsp
        Logger.error("Copilot: Sign-in initiation failed", result.error);
      } else if (result && result.status === "AlreadySignedIn") {
        // This case might be handled by didChangeStatus, but if returned directly:
        setAuthStatus("signedIn");
      }
    } catch (error) {
      Logger.error("Copilot: Sign-in initiation failed", error);
      // Error state (authStatus, authErrorAtom) should be set by initiateSignInLsp
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSignIn = async (evt: React.MouseEvent) => {
    evt.preventDefault();
    setLoading(true);
    setAuthError(null);
    try {
      await confirmSignInLsp();
      // Auth status (signedIn, signInFailed) will be updated by `didChangeStatus` notification
      // from the LSP server, which updates `copilotAuthStatusAtom`.
      // No need to set authStatus directly here unless confirmSignInLsp returns immediate status.
    } catch (error) {
      Logger.error("Copilot: Sign-in confirmation failed", error);
      // Error state (authStatus, authErrorAtom) should be set by confirmSignInLsp
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async (evt: React.MouseEvent) => {
    evt.preventDefault();
    setLoading(true);
    setAuthError(null);
    try {
      await signOutLsp();
      // Auth status will be updated to "signedOut" by signOutLsp.
    } catch (error) {
      Logger.error("Copilot: Sign-out failed", error);
      // Error state (authStatus, authErrorAtom) should be set by signOutLsp
    } finally {
      setLoading(false);
    }
  };

  const renderErrorMessage = () => {
    if (!authError) {
      return null;
    }
    return (
      <div className="text-destructive text-sm flex items-center">
        <AlertTriangleIcon className="h-4 w-4 mr-1" />
        {authError}
      </div>
    );
  };

  const renderBody = () => {
    switch (authStatus) {
      case "uninitialized":
      case "connecting":
        return (
          <div className="flex items-center">
            <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
            <Label className="font-normal">Connecting to GitHub Copilot...</Label>
          </div>
        );
      case "notConnected":
        return (
          <div className="flex flex-col gap-1">
            <Label className="font-normal flex items-center">
              <XIcon className="h-4 w-4 mr-1 text-destructive" />
              Unable to connect to Copilot Server
            </Label>
            {renderErrorMessage()}
            <div className="text-sm">
              For troubleshooting, see the{" "}
              <ExternalLink href="https://docs.marimo.io/getting_started/index.html#github-copilot">
                docs
              </ExternalLink>
              . Or{" "}
              <Button onClick={() => openSettings("ai")} size="xs" variant="link" className="p-0">
                check settings
              </Button>.
            </div>
          </div>
        );
      case "signedOut":
      case "error": // Generic error, allow retry
        return (
          <>
            {renderErrorMessage()}
            <Button onClick={handleSignIn} size="xs" variant="link" disabled={loading}>
              {loading && <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />}
              Sign in to GitHub Copilot
            </Button>
          </>
        );
      case "signingIn":
        if (!userCode || !verificationUri) {
          // This should ideally not happen if status is signingIn
          return (
            <div className="flex items-center">
               <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
              <Label className="font-normal">Preparing sign-in...</Label>
            </div>
          );
        }
        return (
          <ol className="ml-4 text-sm list-decimal [&>li]:mt-2 space-y-2">
            <li>
              <div className="flex items-center">
                Copy this code:
                <strong className="ml-2 mr-1 font-mono">{userCode}</strong>
                <CopyIcon
                  className="cursor-pointer opacity-60 hover:opacity-100 h-3.5 w-3.5"
                  onClick={async () => {
                    if (!userCode) {
                      return;
                    }
                    await copyToClipboard(userCode);
                    toast({
                      description: "Copied to clipboard",
                    });
                  }}
                />
              </div>
            </li>
            <li>
              Enter the code at this link:
              <a
                href={localData?.url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "link", size: "xs" })}
              >
                {localData?.url}
              </a>
            </li>
            <li>
              Click here when done:
              <Button size="xs" onClick={tryFinishSignIn} className="ml-1">
                {loading && (
                  <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />
                )}
                Done
              </Button>
            </li>
          </ol>
        );

      case "signInFailed":
        return (
          <div className="flex flex-col gap-1">
            {renderErrorMessage()}
            <div className="text-destructive text-sm">
              Sign-in failed. Please try again.
            </div>
            <Button onClick={handleSignIn} size="xs" variant="link" disabled={loading}>
              {loading && <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />}
              Retry Sign In
            </Button>
          </div>
        );

      case "signedIn":
        return (
          <div className="flex items-center gap-2">
            <Label className="font-normal flex items-center">
              <div className="inline-flex items-center justify-center bg-[var(--grass-7)] rounded-full p-0.5 mr-1.5">
                <CheckIcon className="h-3 w-3 text-white" />
              </div>
              GitHub Copilot Connected
            </Label>
            <Button onClick={handleSignOut} size="xs" variant="secondary" disabled={loading}>
              {loading && <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />}
              Sign Out
            </Button>
          </div>
        );

      case "connectionError":
        return (
          <div className="flex flex-col gap-1">
            <Label className="font-normal flex">
              <XIcon className="h-4 w-4 mr-1" />
              Connection Error
            </Label>
            <div className="text-sm">Unable to connect to GitHub Copilot.</div>
            <Button onClick={trySignIn} size="xs" variant="link">
              Retry Connection
            </Button>
          </div>
        );
      default:
        // Should not happen if all statuses are handled
        Logger.warn("Copilot: Unhandled auth status", authStatus);
        return (
          <div className="text-destructive text-sm">
            Unknown Copilot status. Please try refreshing.
          </div>
        );
    }
  };

  // This component now primarily focuses on the auth flow UI.
  // The actual enabling/disabling of Copilot via user config (e.g. settings page)
  // would gate whether this component is even rendered or active.
  return (
    <div className="flex flex-col gap-y-1">
      {renderBody()}
    </div>
  );
});
CopilotConfig.displayName = "CopilotConfig";
