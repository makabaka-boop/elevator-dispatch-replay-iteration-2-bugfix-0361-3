export const MIN_FLOORS = 3;
export const MAX_FLOORS = 16;
export const MIN_CARS = 2;
export const MAX_CARS = 4;
export const CAR_CAPACITY = 6;
export const MAX_REQUESTS = 100;
export const DEFAULT_SPEEDS = [1, 2, 4, 8, 16] as const;

export type RequestStatus = 'pending' | 'waiting' | 'riding' | 'completed' | 'cancelled';
export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing' | 'moving';
export type Direction = 1 | -1 | 0;
export type OutageEventType = 'outage' | 'recovery';

export interface DestinationChange {
  tick: number;
  requestId: string;
  destination: number;
}

export interface ScenarioOutageEvent {
  tick: number;
  carId: number;
  type: OutageEventType;
}

export interface ScenarioRequest {
  id?: string;
  arrivalTick: number;
  origin: number;
  destination: number;
  people: number;
  /** If set, the still-not-boarded part is cancelled at this tick. Riding people cannot cancel. */
  cancelTick?: number | null;
}

export interface Scenario {
  floors: number;
  elevators: number;
  travelTicks: number;
  doorOpenTicks: number;
  doorCloseTicks: number;
  requests: ScenarioRequest[];
  outageEvents?: ScenarioOutageEvent[];
  destinationChanges?: DestinationChange[];
}

export interface ValidatedRequest extends ScenarioRequest {
  id: string;
  cancelTick: number | null;
}

export interface ValidatedScenario {
  floors: number;
  elevators: number;
  travelTicks: number;
  doorOpenTicks: number;
  doorCloseTicks: number;
  requests: ValidatedRequest[];
  outageEvents: ScenarioOutageEvent[];
  destinationChanges: DestinationChange[];
}

export interface WaitingRequest {
  requestId: string;
  remaining: number;
}

export interface OnboardRequest {
  requestId: string;
  remaining: number;
  /**
   * Destination agreed at the moment this batch boarded. It is frozen: a later
   * destinationChange only retargets passengers who have not yet boarded, so
   * split batches of one request may ride to different floors.
   */
  destination: number;
}

export interface ElevatorRuntime {
  id: number;
  floor: number;
  targetFloor: number | null;
  direction: Direction;
  phase: DoorPhase;
  phaseElapsed: number;
  onboard: OnboardRequest[];
  waiting: WaitingRequest[];
  attempted: string[];
  /** request IDs selected but not yet serviced at their origin. */
  committedPickups: string[];
  movementTickStarted: number | null;
  idleLogged: boolean;
  outOfService: boolean;
  outageStartedTick: number | null;
}

export interface RequestRuntime {
  id: string;
  arrivalTick: number;
  origin: number;
  destination: number;
  people: number;
  remaining: number;
  boarded: number;
  completed: number;
  cancelled: number;
  cancelTick: number | null;
  status: RequestStatus;
  carId: number | null;
  assignedTick: number | null;
  onboardCarIds: number[];
}

export type SimEventType =
  | 'arrival'
  | 'dispatch'
  | 'dispatch_deferred'
  | 'door_opening'
  | 'door_open'
  | 'door_closing'
  | 'door_closed'
  | 'alight'
  | 'board'
  | 'move_start'
  | 'move_arrive'
  | 'cancel'
  | 'cancel_rejected'
  | 'outage'
  | 'recovery'
  | 'commitment_withdrawn'
  | 'destination_change'
  | 'idle';

export interface SimEvent {
  tick: number;
  carId?: number;
  requestId?: string;
  type: SimEventType;
  message: string;
  floor?: number;
  fromFloor?: number;
  toFloor?: number;
  people?: number;
  remaining?: number;
  eta?: number;
  remainingTicks?: number;
  withdrawnPeople?: number;
  candidates?: Array<{
    carId: number;
    eta: number | null;
    floor: number;
    phase: DoorPhase;
    load: number;
  }>;
  committedPickups?: number[];
  dropOffs?: number[];
  reason?: string;
  peopleOnboard?: number;
}

export interface RequestBatchView {
  carId: number;
  people: number;
  /** Destination this boarded batch is actually bound for (captured at boarding). */
  destination: number;
}

export interface TickRequestView {
  id: string;
  arrivalTick: number;
  origin: number;
  /** Destination currently agreed for everyone in this request who has not boarded yet. */
  destination: number;
  people: number;
  remaining: number;
  boarded: number;
  completed: number;
  cancelled: number;
  cancelTick: number | null;
  status: RequestStatus;
  carId: number | null;
  onboardCarIds: number[];
  /** One entry per car currently carrying a batch of this request, with its own drop floor. */
  onboardBatches: RequestBatchView[];
}

export interface TickCarView {
  id: number;
  floor: number;
  targetFloor: number | null;
  direction: Direction;
  phase: DoorPhase;
  phaseElapsed: number;
  peopleOnboard: number;
  capacity: number;
  outOfService: boolean;
  outageStartedTick: number | null;
  waiting: Array<{ requestId: string; remaining: number }>;
  onboard: Array<{ requestId: string; remaining: number; destination: number }>;
  attempted: string[];
  committedPickupFloors: number[];
  committedDropFloors: number[];
}

export interface TickSnapshot {
  tick: number;
  cars: TickCarView[];
  requests: TickRequestView[];
  events: SimEvent[];
  active: boolean;
  totalWaiting: number;
  totalUnassignedWaiting: number;
  totalRiding: number;
  totalCompleted: number;
  totalCancelled: number;
}

export interface SimulationResult {
  scenario: ValidatedScenario;
  maxTick: number;
  finalTick: number;
  ticks: TickSnapshot[];
  events: SimEvent[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  scenario?: ValidatedScenario;
}
