/**
 * Verification System Contract Configuration
 *
 * Smart contract addresses and ABIs for the HomeTown DAO Verification System
 */

import { getContract } from 'thirdweb';
import { client } from '@/constants/thirdweb';
import { gnosis, gnosisRead } from '@/constants/gnosis';
import { identityContractSet } from '@/constants/identity-contract-set';

// Deployed contract addresses on Gnosis v2 Mainnet (chainId 100, Sybil-hardening
// rotation 2026-06). CitizenNFTv2 / AttesterNFTv2 use dynamic percentage-band
// approval/rejection thresholds rather than a fixed 1+1.
export const VERIFICATION_CONTRACTS = {
  attesterNFT: identityContractSet.attesterNFT,
  citizenNFT: identityContractSet.citizenNFT,
  governor: process.env.EXPO_PUBLIC_GOVERNOR || '0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3',
};

// Contract instances (Gnosis v2)
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

// Read-only handles pinned to the public Gnosis RPC (gnosisRead) rather than
// the hosted thirdweb RPC, which is intermittently rate-limited on preview
// builds (see constants/gnosis.ts / constants/thirdweb.ts). Used ONLY for the
// hasCitizenNFT/hasAttesterNFT checks in VerificationContext — the two reads
// that run on every cold start and gate the whole app. Writes and every other
// read keep using the hosted-chain handles above.
export const citizenNFTReadContract = getContract({
  client,
  address: VERIFICATION_CONTRACTS.citizenNFT,
  chain: gnosisRead,
});

export const attesterNFTReadContract = getContract({
  client,
  address: VERIFICATION_CONTRACTS.attesterNFT,
  chain: gnosisRead,
});

// DEPRECATED on Gnosis v2: thresholds are now dynamic percentage-bands, not a
// fixed 1+1. Do NOT use these constants to DISPLAY how many signatures a request
// needs — read it per-request on-chain instead:
//   CitizenNFTv2.requiredAttesterApprovalsFor(requestId)
//   CitizenNFTv2.requiredCitizenApprovalsFor(requestId)
//   CitizenNFTv2.requiredAttesterRejectionsFor(requestId)
//   CitizenNFTv2.requiredCitizenRejectionsFor(requestId)
//   AttesterNFTv2.requiredApprovalsFor(requestId) / requiredRejectionsFor(requestId)
// Kept only so legacy references compile.
// TODO(gnosis-v2): read requiredAttesterApprovalsFor / requiredCitizenApprovalsFor
export const SIGNATURE_REQUIREMENTS = {
  citizen: {
    attesters: 1,
    citizens: 1,
    minimumApprovers: 2,
  },
  attester: {
    attesters: 2,
  },
  revocation: {
    attesters: 1,
  },
};

/**
 * Contract ABIs
 * Minimal required functions for the verification system
 */

export const ATTESTER_NFT_ABI = [
  'function createAttestationRequest(string evidenceURI) returns (uint256)',
  'function createRevocationRequest(address target, string evidenceURI)',
  'function approveRequest(uint256 requestId)',
  'function rejectRequest(uint256 requestId)',
  'function getRequest(uint256 requestId) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 signatureCount, uint256 createdAt)',
  'function getRequestRejections(uint256 requestId) view returns (uint256)',
  'function hasApprovedRequest(uint256 requestId, address approver) view returns (bool)',
  'function hasRejectedRequest(uint256 requestId, address rejector) view returns (bool)',
  'function hasAttesterNFT(address account) view returns (bool)',
  'function requestCount() view returns (uint256)',
  // AttesterNFTv2: dynamic percentage-band thresholds, read per-request.
  'function requiredApprovalsFor(uint256 requestId) view returns (uint256)',
  'function requiredRejectionsFor(uint256 requestId) view returns (uint256)',
  'function attesterCount() view returns (uint256)',
  'event AttestationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)',
  'event RevocationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)',
  'event RequestApproved(uint256 indexed requestId, address indexed approver)',
  'event RequestRejected(uint256 indexed requestId, address indexed rejector)',
  'event AttesterNFTMinted(address indexed attester, uint256 indexed tokenId, uint256 indexed requestId)',
  'event AttesterNFTRevoked(address indexed attester, uint256 indexed tokenId, uint256 indexed requestId)',
] as const;

export const CITIZEN_NFT_ABI = [
  'function createAttestationRequest(string evidenceURI) returns (uint256)',
  'function createRevocationRequest(address target, string evidenceURI)',
  'function approveRequest(uint256 requestId, bool signAsAttester)',
  'function rejectRequest(uint256 requestId, bool signAsAttester)',
  'function getRequest(uint256 requestId) view returns (address requester, address target, uint8 requestType, uint8 status, string evidenceURI, uint256 attesterSignatures, uint256 citizenSignatures, uint256 createdAt)',
  'function getRequestRejections(uint256 requestId) view returns (uint256 attesterRejections, uint256 citizenRejections)',
  'function hasApprovedRequest(uint256 requestId, address approver) view returns (bool)',
  'function hasRejectedRequest(uint256 requestId, address rejector) view returns (bool)',
  'function hasCitizenNFT(address account) view returns (bool)',
  'function requestCount() view returns (uint256)',
  // CitizenNFTv2: dynamic percentage-band thresholds, read per-request.
  'function requiredAttesterApprovalsFor(uint256 requestId) view returns (uint256)',
  'function requiredCitizenApprovalsFor(uint256 requestId) view returns (uint256)',
  'function requiredAttesterRejectionsFor(uint256 requestId) view returns (uint256)',
  'function requiredCitizenRejectionsFor(uint256 requestId) view returns (uint256)',
  'function isActive(address account) view returns (bool)',
  'function citizenCount() view returns (uint256)',
  'function validUntil(address) view returns (uint64)',
  'event AttestationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)',
  'event RevocationRequestCreated(uint256 indexed requestId, address indexed target, string evidenceURI)',
  // v2 dropped the isAttester/isCitizen booleans — only signedAsAttester remains.
  'event RequestApproved(uint256 indexed requestId, address indexed approver, bool signedAsAttester)',
  'event RequestRejected(uint256 indexed requestId, address indexed rejector, bool signedAsAttester)',
  'event CitizenNFTMinted(address indexed citizen, uint256 indexed tokenId, uint256 indexed requestId)',
  'event CitizenNFTRevoked(address indexed citizen, uint256 indexed tokenId, uint256 indexed requestId)',
] as const;

export const GOVERNOR_ABI = [
  'function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)',
  'function castVote(uint256 proposalId, uint8 support) returns (uint256)',
  'function execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) returns (uint256)',
  'function state(uint256 proposalId) view returns (uint8)',
  'function canPropose(address account) view returns (bool)',
  'function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)',
  'function hasVoted(uint256 proposalId, address account) view returns (bool)',
  'function quorum(uint256 blockNumber) view returns (uint256)',
  'function votingDelay() view returns (uint256)',
  'function votingPeriod() view returns (uint256)',
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)',
  'event ProposalCreatedByAttester(uint256 indexed proposalId, address indexed attester, string description)',
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)',
] as const;
