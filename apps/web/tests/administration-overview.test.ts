import assert from "node:assert/strict";
import test from "node:test";
import { departmentOverview, matchingCase, type TopicOrigin, type OverviewCase } from "../src/lib/administration-review/overview.ts";
const view: OverviewCase = {caseId:"case:original",caseVersion:6,departmentPackages:[],briefReadiness:{status:"waiting",requiredDepartmentIds:["planning"],acceptedDepartmentIds:[]}};
test("missing access and a different Case cannot masquerade as unassigned or reviewed work", () => {
  const source = {caseId:"case:original",admissionVersion:3} as TopicOrigin;
  assert.equal(matchingCase(source,{...view,caseId:"case:local-test"}),null);
  assert.equal(departmentOverview(["planning"],matchingCase(source,{...view,caseId:"case:local-test"}))[0].state,"unknown");
  assert.equal(departmentOverview(["planning"],view)[0].state,"unassigned");
  assert.equal(matchingCase(source,view),view);
  assert.equal(matchingCase(source,{...view,caseVersion:2}),null);
});
test("each department exposes its next missing action; a stale accepted review stays blocked", () => {
  const pkg={id:"package:one",departmentId:"planning",request:"Assess options",reviewState:"assigned"};
  const state=(p: typeof pkg & {draft?:{publicSummary:string;publicCitations:string[]}},extra={}) => departmentOverview(["planning"],{...view,...extra,departmentPackages:[p]})[0].state;
  assert.equal(state(pkg),"assigned");
  const draft={...pkg,draft:{publicSummary:"Answer",publicCitations:["synthetic://source"]}};
  assert.equal(state({...draft,reviewState:"draft_pending_review"}),"pending");
  assert.equal(state({...draft,reviewState:"rejected"}),"rejected");
  assert.equal(state({...draft,reviewState:"accepted"}),"blocked");
  assert.equal(state({...draft,reviewState:"accepted"},{briefReadiness:{...view.briefReadiness,acceptedDepartmentIds:["planning"]}}),"accepted");
  assert.equal(state({...draft,reviewState:"accepted"},{briefReadiness:{...view.briefReadiness,acceptedDepartmentIds:["planning"],blockers:[{departmentId:"planning",reason:"stale"}]}}),"blocked");
});
