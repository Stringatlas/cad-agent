/** Read-only product-agent registry inspection; never an actual provider request or live scene binding. */
export interface AgentToolInspection {
  readonly namespace: 'scene';
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict: boolean;
  readonly requirements: readonly string[];
  readonly skillId: string | null;
}
export interface AgentToolsInspection {
  readonly kind: 'agent-tools-inspection';
  readonly availability: 'unknown-unbound';
  readonly tools: readonly AgentToolInspection[];
  readonly instructions: {
    readonly kind: 'unbound-preview';
    /** Same core instruction builder as runtime, with only unbound baseline tools and no loaded skills/images. */
    readonly text: string;
  };
  readonly skills: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
    readonly tools: readonly string[];
    readonly modes: readonly ('toronto' | 'demo' | 'pole')[];
    readonly dependencies: readonly string[];
  }[];
}
