import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactValue } from "./index.js";

describe("Trace redaction", () => {
  it("redacts default keys, URL credentials, configured keys, and values", () => {
    const source = {
      headers: {
        Authorization: "Bearer top-secret",
        "x-request-id": "safe",
      },
      nested: [
        { password: "hunter2" },
        { privateNote: "do not persist" },
      ],
      url: "https://user:password@example.test/path?token=abc&visible=yes",
      message: "request used project-secret successfully",
    };

    const redacted = redactValue(source, {
      sensitiveKeys: ["privateNote"],
      sensitiveValues: ["project-secret"],
    });

    assert.deepEqual(redacted.headers, {
      Authorization: "[REDACTED]",
      "x-request-id": "safe",
    });
    assert.deepEqual(redacted.nested, [
      { password: "[REDACTED]" },
      { privateNote: "[REDACTED]" },
    ]);
    assert.equal(
      redacted.url,
      "https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/path?token=%5BREDACTED%5D&visible=yes",
    );
    assert.equal(redacted.message, "request used [REDACTED] successfully");
    assert.equal(source.headers.Authorization, "Bearer top-secret");
    assert.equal(source.nested[0]?.password, "hunter2");
  });

  it("adds Project rules without disabling built-in protections", () => {
    assert.deepEqual(
      redactValue(
        { token: "default-secret", customSecret: "project-secret" },
        { sensitiveKeys: ["customSecret"], replacement: "<hidden>" },
      ),
      { token: "<hidden>", customSecret: "<hidden>" },
    );
  });
});
