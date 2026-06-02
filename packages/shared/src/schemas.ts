import { z } from "zod";
import { roomStates } from "./room-state.js";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Expected a MongoDB ObjectId");
export const isoDateStringSchema = z.string().datetime({ offset: true });

export const roleSchema = z.enum(["student", "teacher", "admin", "superadmin"]);
export const roomStateSchema = z.enum(roomStates);

export const createRoomRequestSchema = z.object({
  lessonId: objectIdSchema.optional(),
  title: z.string().min(1).max(160),
  hostParticipantId: z.string().min(1),
  waitingRoomEnabled: z.boolean().default(true),
  startsAt: isoDateStringSchema.optional()
});

export const createRoomResponseSchema = z.object({
  roomId: z.string().min(1),
  meetingId: objectIdSchema,
  state: roomStateSchema,
  createdAt: isoDateStringSchema
});

export const joinRoomRequestSchema = z.object({
  roomId: z.string().min(1),
  participantId: z.string().min(1),
  displayName: z.string().min(1).max(120),
  role: roleSchema
});

export const joinRoomResponseSchema = z.object({
  roomId: z.string().min(1),
  participantId: z.string().min(1),
  state: roomStateSchema,
  admitted: z.boolean()
});

export const chatMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const chatMessageResponseSchema = z.object({
  id: objectIdSchema,
  roomId: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string().min(1),
  body: z.string(),
  createdAt: isoDateStringSchema
});

export const attendanceRecordSchema = z.object({
  participantId: z.string().min(1),
  userId: objectIdSchema,
  displayName: z.string().min(1),
  role: roleSchema,
  joinedAt: isoDateStringSchema,
  leftAt: isoDateStringSchema.nullable(),
  durationSeconds: z.number().int().min(0)
});

export const attendanceReportResponseSchema = z.object({
  meetingId: objectIdSchema,
  lessonId: objectIdSchema.nullable(),
  roomId: z.string().min(1),
  title: z.string().min(1),
  state: roomStateSchema,
  generatedAt: isoDateStringSchema,
  records: z.array(attendanceRecordSchema)
});

export const refreshTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresInSeconds: z.literal(900)
});

export const clientLogRequestSchema = z.object({
  events: z.array(
    z.object({
      level: z.enum(["info", "warn", "error"]),
      message: z.string().min(1).max(4000),
      context: z.record(z.unknown()).default({}),
      occurredAt: isoDateStringSchema
    })
  ).min(1).max(100)
});

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;
export type JoinRoomResponse = z.infer<typeof joinRoomResponseSchema>;
export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;
export type ChatMessageResponse = z.infer<typeof chatMessageResponseSchema>;
export type AttendanceReportResponse = z.infer<typeof attendanceReportResponseSchema>;
export type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>;
export type ClientLogRequest = z.infer<typeof clientLogRequestSchema>;
