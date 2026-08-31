import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkflowRole, type Position } from "@/types/canvas";

export type NeoWorkflowNodeKind = "reference" | "prompt" | "generation" | "output";

const ROLE_NODE_TYPE: Record<NeoWorkflowNodeKind, CanvasNodeType> = {
    reference: CanvasNodeType.Image,
    prompt: CanvasNodeType.Text,
    generation: CanvasNodeType.Config,
    output: CanvasNodeType.Group,
};

const ROLE_TITLE: Record<NeoWorkflowNodeKind, string> = {
    reference: "Reference",
    prompt: "Prompt",
    generation: "Generate",
    output: "Selected Output",
};

/**
 * Create a packaging-design workflow node while preserving the existing
 * Infinite Canvas node primitives and their mature generation/Agent behavior.
 */
export function createNeoWorkflowNode(kind: NeoWorkflowNodeKind, position: Position): CanvasNodeData {
    const workflowRole: CanvasWorkflowRole = kind;
    const node = createCanvasNode(ROLE_NODE_TYPE[kind], position, { workflowRole });
    return { ...node, title: ROLE_TITLE[kind] };
}

export function isNeoWorkflowNode(node: CanvasNodeData, role?: CanvasWorkflowRole) {
    const currentRole = node.metadata?.workflowRole;
    return role ? currentRole === role : Boolean(currentRole);
}
