import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { createGitHubAppJwt, decodeJwtPayload } from "./github-app-jwt";

// Generate a throwaway RSA key pair for testing
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("createGitHubAppJwt", () => {
	test("produces a valid 3-part JWT", () => {
		const jwt = createGitHubAppJwt("12345", privateKey);
		const parts = jwt.split(".");
		expect(parts).toHaveLength(3);
	});

	test("header has alg RS256", () => {
		const jwt = createGitHubAppJwt("12345", privateKey);
		const header = JSON.parse(
			Buffer.from(jwt.split(".")[0], "base64url").toString(),
		);
		expect(header).toEqual({ alg: "RS256", typ: "JWT" });
	});

	test("payload contains correct iss claim", () => {
		const jwt = createGitHubAppJwt("99999", privateKey);
		const payload = decodeJwtPayload(jwt);
		expect(payload.iss).toBe("99999");
	});

	test("payload contains iat and exp claims", () => {
		const jwt = createGitHubAppJwt("12345", privateKey);
		const payload = decodeJwtPayload(jwt);
		expect(payload.iat).toBeNumber();
		expect(payload.exp).toBeNumber();
		expect((payload.exp as number) - (payload.iat as number)).toBe(660);
	});

	test("signature is verifiable with the public key", () => {
		const jwt = createGitHubAppJwt("12345", privateKey);
		const [header, payload, signature] = jwt.split(".");
		const isValid = crypto.verify(
			"sha256",
			Buffer.from(`${header}.${payload}`),
			publicKey,
			Buffer.from(signature, "base64url"),
		);
		expect(isValid).toBe(true);
	});
});
