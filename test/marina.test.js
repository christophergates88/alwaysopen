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

test('"harbor", "marina" in a person’s name, and regulated words never make a business a marina', () => {
  assert.equal(industryOf('Harbor Dental Care', 'Medical, dental or vet'), 'dental');
  assert.equal(industryOf('Harbor Dental Care', 'Other'), 'dental');
  assert.equal(industryOf('Safe Harbor Law Group', 'Other'), 'legal');
  assert.equal(industryOf('Harbor Insurance', 'Other'), 'insurance');
  assert.equal(industryOf('Lakeside Marina Insurance', 'Insurance agency'), 'insurance');
  assert.equal(industryOf('Harbour Grill', 'Restaurant or shop'), 'restaurant');
  assert.equal(industryOf('Harbor Freight', 'Other'), '');
  assert.equal(industryOf('Marina’s Hair Salon', 'Salon, spa or fitness'), 'salon');
  assert.equal(industryOf("Marina's Hair Salon", 'Other'), 'salon');
  assert.equal(industryOf('Northside Pet Clinic', 'Medical, dental or vet'), 'medical');
  assert.equal(industryOf('Drain Doctor Plumbing', 'Contractor or trade'), 'plumbing');
});
