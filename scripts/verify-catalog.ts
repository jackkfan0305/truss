import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { AWS_CATALOG, getAwsCatalogEntry, searchAwsCatalog } from "../lib/aws-catalog";
import { CODE_CATALOG, getCodeCatalogEntry, isGithubSourceUrl, searchCodeCatalog } from "../lib/code-catalog";
import { CATALOG_ENTRIES, isBoundaryCatalogId } from "../lib/catalog";

// Verify catalog structure
assert.equal(AWS_CATALOG.filter((entry) => entry.kind === "service").length, 24);
assert.equal(AWS_CATALOG.filter((entry) => entry.kind === "boundary").length, 6);
assert.equal(new Set(AWS_CATALOG.map((entry) => entry.id)).size, 30);

// Verify each entry
for (const entry of AWS_CATALOG) {
  assert.ok(entry.description.length > 0, `${entry.id} must have a description`);
  assert.match(
    entry.iconPath,
    /^\/aws-icons\/[a-z0-9-]+\.svg$/,
    `${entry.id} has invalid icon path`,
  );
  assert.ok(
    existsSync(`public${entry.iconPath}`),
    `Icon file missing for ${entry.id}: public${entry.iconPath}`,
  );
}

// Verify lookups
assert.equal(getAwsCatalogEntry("aws-vpc")?.kind, "service");
assert.equal(getAwsCatalogEntry("boundary-vpc")?.kind, "boundary");
assert.equal(getAwsCatalogEntry("unknown"), undefined);

// Verify search
assert.ok(searchAwsCatalog(" object storage ").some((entry) => entry.id === "aws-s3"));
assert.equal(searchAwsCatalog("no-such-service").length, 0);

// Verify search is case-insensitive
const vpcResults = searchAwsCatalog("VPC");
assert.ok(vpcResults.some((entry) => entry.id === "aws-vpc"));
assert.ok(vpcResults.some((entry) => entry.id === "boundary-vpc"));

// Verify whitespace-only search returns all entries
assert.equal(searchAwsCatalog("   ").length, AWS_CATALOG.length);

// Verify EKS/VPC searches return both relevant kinds
const eksResults = searchAwsCatalog("eks");
assert.ok(eksResults.some((entry) => entry.id === "aws-eks"));
assert.ok(eksResults.some((entry) => entry.id === "boundary-eks-cluster"));


assert.deepEqual(CODE_CATALOG.map((e) => e.id), [
  "code-entry", "code-function", "code-method", "code-type", "code-enum", "code-class", "code-module",
]);
assert.deepEqual(CODE_CATALOG.filter((e) => e.kind === "boundary").map((e) => e.id), ["code-class", "code-module"]);
for (const entry of CODE_CATALOG) assert.ok(entry.description.length > 0 && entry.icon.length > 0, entry.id);

assert.equal(new Set(CATALOG_ENTRIES.map((e) => e.id)).size, CATALOG_ENTRIES.length, "ids unique across families");
assert.equal(CATALOG_ENTRIES.filter((e) => e.family === "code").length, 7);
assert.equal(CATALOG_ENTRIES.filter((e) => e.family === "aws").length, 30);
assert.ok(isBoundaryCatalogId("code-class") && isBoundaryCatalogId("boundary-vpc"));
assert.ok(!isBoundaryCatalogId("code-function") && !isBoundaryCatalogId("aws-s3"));

assert.equal(getCodeCatalogEntry("code-type")?.kind, "block");
assert.ok(searchCodeCatalog("struct").some((e) => e.id === "code-type"));
assert.equal(searchCodeCatalog("  ").length, 7);

assert.ok(isGithubSourceUrl("https://github.com/o/r/blob/abc/lib/a.ts#L3"));
for (const bad of ["javascript:alert(1)", "https://github.com.evil.com/x", "http://github.com/o/r", " https://github.com/o", "https://gitlab.com/o"]) {
  assert.ok(!isGithubSourceUrl(bad), bad);
}

async function main() {
  const { GET } = await import("../app/api/agent/catalog/route");
  const body = await GET().json();
  assert.equal(body.catalogVersion, 1);
  assert.ok(body.entries.every((e: { family?: string }) => e.family === "aws" || e.family === "code"));
  console.log("✓ All catalog assertions passed");
}

void main();
