// What Max asks callers, and what counts as urgent, by kind of business, for owners who haven't said.
// The industry comes from provision.js (industryOf). The owner's own answers always win (interview.js, the Max tab).

// Kinds of work where people call with something broken: Spanish on by default, check-in calls on by default.
export const TRADES = new Set(['plumbing', 'hvac', 'electrical', 'roofing', 'landscaping', 'pest control', 'pools', 'painting', 'tree service',
  'pressure washing', 'cleaning', 'fencing', 'concrete', 'garage doors', 'septic', 'gutters', 'flooring', 'builders', 'moving', 'contractor',
  'handyman', 'appliance repair', 'locksmith', 'docks', 'marine', 'auto repair']);

// Message-only kinds: Max never quotes, books or discusses specifics.
export const MESSAGE_ONLY = new Set(['insurance', 'legal', 'medical', 'dental']);

const HOME = 'their name, the address or town, what is going on, and how soon they need someone';
const DEFAULTS = {
  plumbing: { intake: HOME + ' (a leak: is the water shut off?)', urgent: 'water actively leaking or flooding, no water at all, sewage backing up, a gas smell' },
  hvac: { intake: HOME + ' (the system type if they know it)', urgent: 'no heat in freezing weather, no cooling in extreme heat with someone elderly, young or ill at home, a gas smell or carbon monoxide alarm' },
  electrical: { intake: HOME, urgent: 'sparks, burning smell, smoke, a whole-house outage, or exposed live wires' },
  roofing: { intake: HOME + ' (is water coming inside?)', urgent: 'water coming into the house, or storm damage that left the roof open' },
  'garage doors': { intake: HOME, urgent: 'a car trapped inside or a door that will not close' },
  locksmith: { intake: HOME, urgent: 'locked out of a home or car, or a lock broken after a break-in' },
  'pest control': { intake: HOME + ' (what pest, and where they see it)', urgent: 'stinging insects near people, or a snake inside' },
  'tree service': { intake: HOME, urgent: 'a tree down on a house, car, power line or blocking the only driveway' },
  septic: { intake: HOME, urgent: 'sewage backing up into the house' },
  'auto repair': { intake: 'their name, the year, make and model, what the car is doing, and whether it can be driven', urgent: 'a car that will not start or is unsafe to drive' },
  docks: { intake: 'their name, the lake and address, what they need (new dock, repair, lift), and the timeline', urgent: 'a dock or lift coming apart with a boat on it' },
  marine: { intake: 'their name, the boat (make, length, engine), what is wrong, and where it is', urgent: 'a boat taking on water' },
  salon: { intake: 'their name, the service they want, a stylist if they have one, and the days and times that work', urgent: '' },
  barber: { intake: 'their name, the service, and the days and times that work', urgent: '' },
  restaurant: { intake: 'their name, what they are calling about (a reservation, catering, an order, hours), the date and party size', urgent: '' },
  'pet grooming': { intake: 'their name, the pet (kind, breed, size), the service, and the days that work', urgent: '' },
  insurance: { intake: 'their name and the best number, and in a few words what it is about (no policy numbers or details)', urgent: '' },
  legal: { intake: 'their name and the best number, and in a few words what it is about (no case details)', urgent: '' },
  medical: { intake: 'their name and the best number, and in a few words what it is about (no health details)', urgent: 'anything that sounds like a medical emergency: tell them to hang up and call 911' },
  dental: { intake: 'their name and the best number, and whether they are a current patient (no health details)', urgent: 'severe pain, swelling or a knocked-out tooth: someone will call back as soon as possible' }
};
const TRADE_DEFAULT = { intake: HOME, urgent: 'anything that is causing damage right now or makes the home unsafe' };

export function tradeDefaults(industry) {
  const k = String(industry || '').toLowerCase().trim();
  if (DEFAULTS[k]) return DEFAULTS[k];
  if (TRADES.has(k)) return TRADE_DEFAULT;
  return { intake: '', urgent: '' };
}
export function isTrade(industry) { return TRADES.has(String(industry || '').toLowerCase().trim()); }
