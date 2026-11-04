import test from 'node:test';
import assert from 'node:assert/strict';
import { industryOf } from '../src/provision.js';
import { tradeDefaults } from '../src/trades.js';

test('a marina is a marina, not a boat repair shop', () => {
  assert.equal(industryOf('Harbor Point Marina', 'Dock, marine or outdoor'), 'marina');
  assert.equal(industryOf('Lake Oconee Boat Rentals', 'Dock, marine or outdoor'), 'marina');
  assert.equal(industryOf('Kessler Marine', 'Dock, marine or outdoor'), 'marine');
  assert.equal(industryOf('Shoreline Docks', 'Dock, marine or outdoor'), 'docks');
});

test('Max asks a marina caller about the slip, rental, fuel or service', () => {
  const d = tradeDefaults('marina');
  assert.match(d.intake, /slip/); assert.match(d.intake, /rental/); assert.match(d.urgent, /taking on water/);
});
