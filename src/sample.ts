import type { Scenario } from './engine/types';

export const sampleScenario: Scenario = {
  floors: 10,
  elevators: 3,
  travelTicks: 2,
  doorOpenTicks: 1,
  doorCloseTicks: 1,
  requests: [
    { id: 'R001', arrivalTick: 1, origin: 1, destination: 8, people: 6 },
    { id: 'R002', arrivalTick: 1, origin: 1, destination: 5, people: 4 },
    { id: 'R003', arrivalTick: 2, origin: 3, destination: 1, people: 2 },
    { id: 'R004', arrivalTick: 3, origin: 6, destination: 2, people: 8, cancelTick: 30 },
    { id: 'R005', arrivalTick: 4, origin: 1, destination: 10, people: 1 },
    { id: 'R006', arrivalTick: 12, origin: 9, destination: 1, people: 3 }
  ],
  outageEvents: [
    { tick: 10, carId: 0, type: 'outage' },
    { tick: 12, carId: 0, type: 'recovery' },
    { tick: 18, carId: 1, type: 'outage' },
    { tick: 20, carId: 1, type: 'recovery' }
  ],
  destinationChanges: [{ tick: 6, requestId: 'R004', destination: 9 }]
};

export const stressScenario: Scenario = {
  floors: 16,
  elevators: 4,
  travelTicks: 1,
  doorOpenTicks: 1,
  doorCloseTicks: 1,
  requests: Array.from({ length: 32 }, (_, index) => {
    const origin = (index * 7) % 16 + 1;
    let destination = (index * 11) % 16 + 1;
    if (destination === origin) destination = destination === 16 ? 1 : destination + 1;
    return {
      id: `R${String(index + 1).padStart(3, '0')}`,
      arrivalTick: index * 2,
      origin,
      destination,
      people: (index % 8) + 1,
      ...(index % 9 === 4 ? { cancelTick: index * 2 + 5 } : {})
    };
  })
};
