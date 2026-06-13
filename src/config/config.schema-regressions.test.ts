import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("config schema regressions", () => {
  it("accepts nested telegram groupPolicy overrides", () => {
    const res = validateConfigObject({
      channels: {
        telegram: {
          groups: {
            "-1001234567890": {
              groupPolicy: "open",
              topics: {
                "42": {
                  groupPolicy: "disabled",
                },
              },
            },
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it('accepts memorySearch fallback "voyage"', () => {
    const res = validateConfigObject({
      agents: {
        defaults: {
          memorySearch: {
            fallback: "voyage",
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("accepts deprecated local config keys without invalidating startup config", () => {
    const res = validateConfigObject({
      gateway: { mode: "local" },
      agents: {
        defaults: {
          models: {
            "openai/gpt-5.4": {
              agentRuntime: { id: "codex" },
            },
          },
        },
        list: [
          {
            id: "main",
            models: {
              "openai/gpt-5.3-codex": {
                agentRuntime: { id: "codex" },
              },
            },
          },
        ],
      },
      messages: {
        groupChat: {
          visibleReplies: "compact",
        },
      },
      channels: {
        telegram: {
          streaming: { mode: "block", block: {}, preview: false },
          accounts: {
            default: {
              streaming: { mode: "block", block: {}, preview: false },
            },
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("accepts inbound-only BlueBubbles Text Mailroom config", () => {
    const res = validateConfigObject({
      channels: {
        bluebubbles: {
          enabled: true,
          serverUrl: "http://host.docker.internal:1234",
          password: "test-password",
          webhookPath: "/bluebubbles-webhook",
          dmPolicy: "allowlist",
          allowFrom: ["+15551230000"],
          groupPolicy: "disabled",
          textMailroom: {
            enabled: true,
            includeGroups: false,
            autoClassify: true,
            exportPrestigio: false,
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });
});
