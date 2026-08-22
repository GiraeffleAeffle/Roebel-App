# ADR 0016: Review-gated public knowledge and attributed community context

- Status: Accepted for staging
- Date: 2026-08-22

## Context

A Grok-like Public Mecky should help in an ordinary Röbel conversation by combining the current signed statement with relevant civic cases, local reporting and council records. Treating every indexed item as equally "verified" would turn citizen speech into fact, confuse a council paper with a later decision, and let a crawler bypass the existing review process.

## Decision

Public Mecky retrieves through one Public Knowledge Catalog and receives one bounded Public Evidence Packet. Every source passes source-specific admission before ranking and retains a fixed source authority:

- a signature-valid, source-bound post that directly mentions Mecky may admit that exact note as a `community_statement`; the mention is retrieval consent for that conversation, not factual verification;
- local news enters only through a versioned, human-reviewed public projection and remains an attributed `editorial_report`;
- Ratsinformationssystem material enters only through a checksum-bound reviewed extraction and remains an `official_record` describing what that record states, not proof of a later decision or execution;
- a reviewed Civic Case remains `reviewed_civic_evidence` only within its published scope.

Admission state and source authority are separate fields. Corrections, withdrawal, supersession, municipality mismatch, missing consent, invalid signatures and pending review remove an item before rank. The answer cites only identifiers selected from the packet, records omissions, and keeps `authorityBinding: none` with every civic effect false. The answer path never scrapes news or ALLRIS directly and receives no application, administration, voting or treasury write credential.

## Consequences

Ordinary conversation becomes useful before civic promotion, while the UI can truthfully distinguish "Anna reported" from "the newspaper reported", "the paper states" and "the reviewed case says". Adding a new source requires a reviewed projection adapter and correction tests rather than a prompt change. Missing reviewed sources yield an explicit limitation instead of model-memory prose.

ADR 0017 defines the checksum-bound GET-only projection used to admit reviewed local news and Ratsinformationssystem records without reviewing every generated answer.
