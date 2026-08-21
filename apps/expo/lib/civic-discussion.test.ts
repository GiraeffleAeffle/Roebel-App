import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareCivicDiscussionPost } from './civic-discussion';

const route = {
  municipality: 'roebel-mueritz',
  case: 'marienfelder-strasse',
  stadtstackCase:
    'urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001',
  title: 'Marienfelder Straße',
};

test('prepares one explicit Mecky question bound to the reviewed Stadtstack Case', () => {
  assert.deepEqual(
    prepareCivicDiscussionPost(route, 'Welche geprüften Informationen gibt es dazu?'),
    {
      binding: {
        municipalityId: 'roebel-mueritz',
        sourceCaseId: 'marienfelder-strasse',
        canonicalCaseId:
          'urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001',
      },
      title: 'Marienfelder Straße',
      content: '@Mecky, Welche geprüften Informationen gibt es dazu?',
    },
  );
});

test('rejects ambiguous route values, wrong municipalities and malformed questions', () => {
  for (const [candidate, question] of [
    [{ ...route, case: ['marienfelder-strasse'] }, 'Was ist bekannt?'],
    [{ ...route, municipality: 'another-town' }, 'Was ist bekannt?'],
    [
      {
        ...route,
        stadtstackCase:
          'urn:stadtstack:case:municipality:another-town:018f0000-0000-7000-8000-000000000001',
      },
      'Was ist bekannt?',
    ],
    [route, ' Was ist bekannt?'],
    [route, ''],
  ] as const) {
    assert.throws(
      () => prepareCivicDiscussionPost(candidate, question),
      /civic_discussion_input_invalid/,
    );
  }
});
