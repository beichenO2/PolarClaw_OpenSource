/**
 * Channel Port — 消息通道抽象
 *
 * 所有消息来源（飞书、Web、CLI）都实现此接口。
 * Channel 是最靠近用户的一层，也是隐私网关的安装点。
 */

/** 入站消息（用户 → Agent） */
export interface IInboundMessage {
  /** 通道来源标识 */
  channel: string;
  /** 用户 ID（通道内唯一） */
  userId: string;
  /** 消息原文 */
  text: string;
  /** 附件（图片、文件等） */
  attachments?: IAttachment[];
  /** 消息时间戳 */
  timestamp: Date;
  /** 通道原始元数据（飞书 message_id 等） */
  metadata?: Record<string, unknown>;
}

export interface IAttachment {
  type: 'image' | 'file' | 'audio' | 'video';
  url?: string;
  /** base64 或 Buffer */
  data?: string;
  mimeType?: string;
  filename?: string;
}

/** 出站消息（Agent → 用户） */
export interface IOutboundMessage {
  userId: string;
  text: string;
  /** 富文本卡片（飞书 Interactive Card 等） */
  card?: Record<string, unknown>;
}

/** 通道适配器接口 */
export interface IChannelAdapter {
  /** 通道名称（唯一标识） */
  readonly name: string;

  /** 启动通道监听 */
  start(): Promise<void>;

  /** 停止通道 */
  stop(): Promise<void>;

  /** 发送出站消息 */
  send(message: IOutboundMessage): Promise<void>;

  /** 注册入站消息处理器 */
  onMessage(handler: (message: IInboundMessage) => Promise<string>): void;

  /** 启动时补漏（可选，自动发现会话列表或指定 chatIds） */
  catchUp?(chatIds?: string[]): Promise<void>;
}
