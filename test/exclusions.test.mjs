import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeExcludedKeys } from '../src/exclusions.ts';

// Derek's real shape: "RPG Manuals" is itself a subcollection of "2 - Type",
// with game collections nested beneath it.
const TREE = [
  { key: 'TYPE', name: '2 - Type', parentCollection: false },
  { key: 'RPG', name: 'RPG Manuals', parentCollection: 'TYPE' },
  { key: 'MOTH', name: 'Mothership', parentCollection: 'RPG' },
  { key: 'STONE', name: 'Stonetop', parentCollection: 'RPG' },
  { key: 'TRI', name: 'Triangle Agency', parentCollection: 'RPG' },
  { key: 'BOARD', name: 'Boardgame Manuals', parentCollection: 'TYPE' },
  { key: 'PROJ', name: '1 - Projects', parentCollection: false },
];

test('a subcollection seed expands to all descendants', () => {
  const { keys, unmatched } = computeExcludedKeys(TREE, ['RPG Manuals']);
  assert.deepEqual([...keys].sort(), ['MOTH', 'RPG', 'STONE', 'TRI']);
  assert.deepEqual(unmatched, []);
});

test('matching is trimmed and case-insensitive', () => {
  const { keys } = computeExcludedKeys(TREE, ['  rpg manuals  ']);
  assert.ok(keys.has('RPG') && keys.has('STONE'));
});

test('duplicate names all match', () => {
  const dupes = [
    ...TREE,
    { key: 'RPG2', name: 'RPG Manuals', parentCollection: 'PROJ' },
    { key: 'RPG2KID', name: 'Old Drafts', parentCollection: 'RPG2' },
  ];
  const { keys } = computeExcludedKeys(dupes, ['RPG Manuals']);
  assert.ok(keys.has('RPG') && keys.has('RPG2') && keys.has('RPG2KID'));
});

test('unmatched names are reported, matched ones still expand', () => {
  const { keys, unmatched } = computeExcludedKeys(TREE, ['RPG Manualz', 'Stonetop']);
  assert.deepEqual(unmatched, ['rpg manualz']);
  assert.deepEqual([...keys], ['STONE']);
});

test('empty or blank config excludes nothing', () => {
  assert.equal(computeExcludedKeys(TREE, []).keys.size, 0);
  assert.equal(computeExcludedKeys(TREE, ['', '  ']).keys.size, 0);
});

test('multiple names union, overlapping subtrees deduplicate', () => {
  const { keys } = computeExcludedKeys(TREE, ['RPG Manuals', 'Mothership']);
  assert.deepEqual([...keys].sort(), ['MOTH', 'RPG', 'STONE', 'TRI']);
});
