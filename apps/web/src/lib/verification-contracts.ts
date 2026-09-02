/**
 * Verification System Contract Addresses
 * Update these after deploying the contracts
 */

import { getContract } from "thirdweb";
import { client } from "@/app/client";
import { gnosis } from "@/lib/gnosis";
import { identityContractSet } from "@/lib/identity-contract-set";

// Deployed contract addresses on Gnosis mainnet (v2 Sybil-hardened, 2026-06-25).
//
// The identity addresses cross one fail-closed contract-set seam. Staging may
// select the reviewed test pair, but cannot independently override either NFT.
// See docs/ONCHAIN_TEST_ENVIRONMENT.md.
export const VERIFICATION_CONTRACTS = {
  attesterNFT: identityContractSet.attesterNFT,
  citizenNFT: identityContractSet.citizenNFT,
  governor: process.env.NEXT_PUBLIC_GOVERNOR || "0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3", // MaciAttesterGovernor (Gnosis v2)
};

// Lowercase contract address for the active CitizenNFT/AttesterNFT, used to scope
// request_evidence rows so rotations no longer collide with archived contract rows
// on (request_id, contract_type, contract_address).
export const currentContractAddress = (type: "citizen" | "attester"): string =>
  (type === "citizen"
    ? VERIFICATION_CONTRACTS.citizenNFT
    : VERIFICATION_CONTRACTS.attesterNFT
  ).toLowerCase();

// Contract instances
export const attesterNFTContract = getContract({
  client,
  address: VERIFICATION_CONTRACTS.attesterNFT,
  chain: gnosis,
});

export const citizenNFTContract = getContract({
  client,
  address: VERIFICATION_CONTRACTS.citizenNFT,
  chain: gnosis,
});

export const governorContract = getContract({
  client,
  address: VERIFICATION_CONTRACTS.governor,
  chain: gnosis,
});

// Contract ABIs (minimal required functions)
export const ATTESTER_NFT_ABI = [
  "function createAttestationRequest(string evidenceURI) returns (uint256)",
  "function createRevocationRequest(address target, string evidenceURI)",
  "function approveRequest(uint256 requestId)",
  "function rejectRequest(uint256 requestId)",
  "function getRequest(uint256 requestId) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 signatureCount, uint256 createdAt)",
  "function getRequestRejections(uint256 requestId) view returns (uint256)",
  "function hasApprovedRequest(uint256 requestId, address approver) view returns (bool)",
  "function hasRejectedRequest(uint256 requestId, address rejector) view returns (bool)",
  "function hasAttesterNFT(address account) view returns (bool)",
  "function requestCount() view returns (uint256)",
  // v2: per-request thresholds + member count (replaced requiredSignatures/requiredRejections)
  "function requiredApprovalsFor(uint256 requestId) view returns (uint256)",
  "function requiredRejectionsFor(uint256 requestId) view returns (uint256)",
  "function attesterCount() view returns (uint256)",
  "event AttestationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)",
  "event RevocationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)",
  "event RequestApproved(uint256 indexed requestId, address indexed approver)",
  "event RequestRejected(uint256 indexed requestId, address indexed rejector)",
  "event AttesterNFTMinted(address indexed attester, uint256 indexed tokenId, uint256 indexed requestId)",
  "event AttesterNFTRevoked(address indexed attester, uint256 indexed tokenId, uint256 indexed requestId)",
] as const;

export const CITIZEN_NFT_ABI = [
  "function createAttestationRequest(string evidenceURI) returns (uint256)",
  "function createRevocationRequest(address target, string evidenceURI)",
  "function approveRequest(uint256 requestId, bool signAsAttester)",
  "function rejectRequest(uint256 requestId, bool signAsAttester)",
  "function getRequest(uint256 requestId) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 attesterSignatures, uint256 citizenSignatures, uint256 createdAt)",
  "function getRequestRejections(uint256 requestId) view returns (uint256 attesterRejections, uint256 citizenRejections)",
  "function hasApprovedRequest(uint256 requestId, address approver) view returns (bool)",
  "function hasRejectedRequest(uint256 requestId, address rejector) view returns (bool)",
  "function hasCitizenNFT(address account) view returns (bool)",
  "function requestCount() view returns (uint256)",
  "function getVotes(address account) view returns (uint256)",
  // v2: per-request thresholds (replaced the 6 global required* getters)
  "function requiredAttesterApprovalsFor(uint256 requestId) view returns (uint256)",
  "function requiredCitizenApprovalsFor(uint256 requestId) view returns (uint256)",
  "function requiredAttesterRejectionsFor(uint256 requestId) view returns (uint256)",
  "function requiredCitizenRejectionsFor(uint256 requestId) view returns (uint256)",
  // v2: Sybil-hardened identity views
  "function isActive(address account) view returns (bool)",
  "function citizenCount() view returns (uint256)",
  "function validUntil(address account) view returns (uint256)",
  "event AttestationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)",
  "event RevocationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)",
  "event RequestApproved(uint256 indexed requestId, address indexed approver, bool signedAsAttester)",
  "event RequestRejected(uint256 indexed requestId, address indexed rejector, bool signedAsAttester)",
  "event CitizenNFTMinted(address indexed citizen, uint256 indexed tokenId, uint256 indexed requestId)",
  "event CitizenNFTRevoked(address indexed citizen, uint256 indexed tokenId, uint256 indexed requestId)",
] as const;

// AttesterGovernor ABI (for proposal creation and voting)
export const GOVERNOR_ABI = [
  "function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)",
  "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
  "function execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) returns (uint256)",
  "function state(uint256 proposalId) view returns (uint8)",
  "function canPropose(address account) view returns (bool)",
  "function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function hasVoted(uint256 proposalId, address account) view returns (bool)",
  "function quorum(uint256 blockNumber) view returns (uint256)",
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
  "event ProposalCreatedByAttester(uint256 indexed proposalId, address indexed attester, string description)",
  "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)",
] as const;
