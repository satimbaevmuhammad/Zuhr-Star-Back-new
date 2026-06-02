export const roomStates = [
  "IDLE",
  "WAITING_ROOM",
  "ACTIVE",
  "RECORDING",
  "ENDING",
  "ARCHIVED"
] as const;

export type RoomState = (typeof roomStates)[number];

export type RoomStateTransition = {
  readonly from: RoomState;
  readonly to: RoomState;
  readonly reason: string;
};

export const allowedRoomStateTransitions: readonly RoomStateTransition[] = [
  { from: "IDLE", to: "WAITING_ROOM", reason: "Host creates room" },
  { from: "WAITING_ROOM", to: "ACTIVE", reason: "Host starts meeting" },
  { from: "ACTIVE", to: "RECORDING", reason: "Host starts recording" },
  { from: "RECORDING", to: "ACTIVE", reason: "Host stops recording" },
  { from: "ACTIVE", to: "ENDING", reason: "Host ends meeting or last participant leaves" },
  { from: "ENDING", to: "ARCHIVED", reason: "Cleanup job finalizes meeting" }
] as const;

export const canTransitionRoomState = (from: RoomState, to: RoomState): boolean =>
  allowedRoomStateTransitions.some((transition) => transition.from === from && transition.to === to);
