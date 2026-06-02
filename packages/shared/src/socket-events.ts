import type { Role } from "./roles.js";
import type { RoomState } from "./room-state.js";

export type ParticipantMediaState = {
  readonly audioEnabled: boolean;
  readonly videoEnabled: boolean;
  readonly screenSharing: boolean;
  readonly handRaised: boolean;
};

export type NetworkQualityScore = 0 | 1 | 2 | 3 | 4;

export type ParticipantSummary = {
  readonly participantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: Role;
  readonly joinedAt: string | null;
  readonly media: ParticipantMediaState;
  readonly networkQuality: NetworkQualityScore;
};

export type ChatMessageDto = {
  readonly id: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly body: string;
  readonly createdAt: string;
};

export type ProducerAppData = {
  readonly participantId: string;
  readonly type: "camera" | "microphone" | "screen";
};

export type TransportDirection = "send" | "recv";

export type IceCandidateDto = {
  readonly foundation: string;
  readonly priority: number;
  readonly ip: string;
  readonly address?: string;
  readonly protocol: "udp" | "tcp";
  readonly port: number;
  readonly type: "host" | "srflx" | "prflx" | "relay";
  readonly tcpType?: "active" | "passive" | "so";
};

export type IceParametersDto = {
  readonly usernameFragment: string;
  readonly password: string;
  readonly iceLite?: boolean;
};

export type DtlsFingerprintDto = {
  readonly algorithm: string;
  readonly value: string;
};

export type DtlsParametersDto = {
  readonly role?: "auto" | "client" | "server";
  readonly fingerprints: readonly DtlsFingerprintDto[];
};

export type RtpCodecCapabilityDto = {
  readonly kind: "audio" | "video";
  readonly mimeType: string;
  readonly preferredPayloadType?: number;
  readonly clockRate: number;
  readonly channels?: number;
  readonly parameters?: Record<string, string | number>;
  readonly rtcpFeedback?: readonly { readonly type: string; readonly parameter?: string }[];
};

export type RtpHeaderExtensionDto = {
  readonly kind: "audio" | "video";
  readonly uri: string;
  readonly preferredId: number;
  readonly preferredEncrypt?: boolean;
  readonly direction?: "sendrecv" | "sendonly" | "recvonly" | "inactive";
};

export type RouterRtpCapabilitiesDto = {
  readonly codecs: readonly RtpCodecCapabilityDto[];
  readonly headerExtensions: readonly RtpHeaderExtensionDto[];
};

export type RtpEncodingParametersDto = {
  readonly rid?: string;
  readonly maxBitrate?: number;
  readonly scalabilityMode?: string;
  readonly scaleResolutionDownBy?: number;
  readonly active?: boolean;
};

export type RtpParametersDto = {
  readonly mid?: string;
  readonly codecs: readonly Record<string, unknown>[];
  readonly headerExtensions?: readonly Record<string, unknown>[];
  readonly encodings?: readonly RtpEncodingParametersDto[];
  readonly rtcp?: Record<string, unknown>;
};

export type WebRtcTransportOptionsDto = {
  readonly id: string;
  readonly iceParameters: IceParametersDto;
  readonly iceCandidates: readonly IceCandidateDto[];
  readonly dtlsParameters: DtlsParametersDto;
};

type BaseSocketEvent<TType extends string, TPayload> = {
  readonly type: TType;
  readonly payload: TPayload;
  readonly roomId: string;
  readonly senderId: string;
  readonly timestamp: string;
};

export type ClientToServerSocketEvent =
  | BaseSocketEvent<"joinRoom", { readonly participantId: string }>
  | BaseSocketEvent<"leaveRoom", { readonly participantId: string }>
  | BaseSocketEvent<"createTransport", { readonly direction: TransportDirection }>
  | BaseSocketEvent<"connectTransport", { readonly transportId: string; readonly dtlsParameters: DtlsParametersDto }>
  | BaseSocketEvent<"produce", { readonly transportId: string; readonly kind: "audio" | "video"; readonly rtpParameters: RtpParametersDto; readonly appData: ProducerAppData }>
  | BaseSocketEvent<"consume", { readonly producerId: string; readonly transportId: string; readonly rtpCapabilities: RouterRtpCapabilitiesDto; readonly preferredLayers?: { readonly spatialLayer: number; readonly temporalLayer: number } }>
  | BaseSocketEvent<"consumerResume", { readonly consumerId: string }>
  | BaseSocketEvent<"setConsumerPreferredLayers", { readonly consumerId: string; readonly spatialLayer: number; readonly temporalLayer: number }>
  | BaseSocketEvent<"sendMessage", { readonly body: string }>
  | BaseSocketEvent<"raiseHand", { readonly raised: boolean }>
  | BaseSocketEvent<"toggleOwnMedia", ParticipantMediaState>
  | BaseSocketEvent<"kickParticipant", { readonly participantId: string }>
  | BaseSocketEvent<"muteParticipant", { readonly participantId: string; readonly media: "audio" | "video" }>
  | BaseSocketEvent<"muteAll", { readonly media: "audio" | "video" }>
  | BaseSocketEvent<"admitFromWaiting", { readonly participantId: string }>
  | BaseSocketEvent<"denyFromWaiting", { readonly participantId: string; readonly reason: string }>
  | BaseSocketEvent<"startRecording", { readonly requestedBy: string }>
  | BaseSocketEvent<"stopRecording", { readonly requestedBy: string }>
  | BaseSocketEvent<"networkQuality", { readonly participantId: string; readonly score: NetworkQualityScore; readonly rttMs: number; readonly jitterMs: number; readonly packetLossRatio: number }>;

export type ServerToClientSocketEvent =
  | BaseSocketEvent<"routerRtpCapabilities", RouterRtpCapabilitiesDto>
  | BaseSocketEvent<"transportCreated", WebRtcTransportOptionsDto & { readonly direction: TransportDirection }>
  | BaseSocketEvent<"transportConnected", { readonly transportId: string }>
  | BaseSocketEvent<"produced", { readonly producerId: string }>
  | BaseSocketEvent<"newProducer", { readonly producerId: string; readonly participantId: string; readonly kind: "audio" | "video"; readonly appData: ProducerAppData }>
  | BaseSocketEvent<"consumerCreated", { readonly consumerId: string; readonly producerId: string; readonly kind: "audio" | "video"; readonly rtpParameters: RtpParametersDto }>
  | BaseSocketEvent<"activeSpeaker", { readonly participantId: string; readonly volume: number }>
  | BaseSocketEvent<"participantJoined", ParticipantSummary>
  | BaseSocketEvent<"roomParticipants", { readonly participants: readonly ParticipantSummary[] }>
  | BaseSocketEvent<"participantLeft", { readonly participantId: string; readonly leftAt: string }>
  | BaseSocketEvent<"participantUpdated", ParticipantSummary>
  | BaseSocketEvent<"messageCreated", ChatMessageDto>
  | BaseSocketEvent<"roomStateChanged", { readonly previousState: RoomState; readonly nextState: RoomState; readonly changedBy: string }>
  | BaseSocketEvent<"recordingStateChanged", { readonly active: boolean; readonly recordingId?: string }>
  | BaseSocketEvent<"waitingRoomUpdated", { readonly participants: readonly ParticipantSummary[] }>
  | BaseSocketEvent<"admittedFromWaiting", { readonly participantId: string }>
  | BaseSocketEvent<"deniedFromWaiting", { readonly participantId: string; readonly reason: string }>
  | BaseSocketEvent<"permissionDenied", { readonly eventType: ClientToServerSocketEvent["type"]; readonly reason: string }>
  | BaseSocketEvent<"error", { readonly code: string; readonly message: string }>;

export type SocketEvent = ClientToServerSocketEvent | ServerToClientSocketEvent;
