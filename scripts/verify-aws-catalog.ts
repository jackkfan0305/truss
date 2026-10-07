import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { AWS_CATALOG, getAwsCatalogEntry, searchAwsCatalog } from "../lib/aws-catalog";

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

console.log("✓ All AWS catalog assertions passed");
