// Fake model catalog used to drive the clone's filtering / sorting / pagination.
export type BadgeKind = "downloadable" | "free-endpoint";

export interface Model {
  id: string;
  provider: string;
  /** Tailwind color used for the provider logo tile. */
  logoColor: string;
  name: string;
  description: string;
  badges: BadgeKind[];
  partnerEndpoint: boolean;
  tags: string[];
  downloads: string;
  downloadsNum: number;
  age: string;
  ageDays: number;
  useCases: string[];
  providers: string[];
}

export const USE_CASES = [
  "Chat",
  "Reasoning",
  "Code Generation",
  "Retrieval (RAG)",
  "Image Generation",
  "Visual Design",
] as const;

export const INFERENCE_PROVIDERS = [
  "NVIDIA",
  "Hugging Face",
  "Fireworks",
  "Together",
  "Baseten",
] as const;

export const MODELS: Model[] = [
  {
    id: "glm-5.1",
    provider: "Z.ai",
    logoColor: "bg-[#2f6df6]",
    name: "glm-5.1",
    description:
      "Frontier reasoning model with agentic tool-use and a 200K context window, optimized for long-horizon planning and code.",
    badges: ["free-endpoint"],
    partnerEndpoint: true,
    tags: ["Reasoning", "Agentic", "200K context"],
    downloads: "842K",
    downloadsNum: 842_000,
    age: "2 weeks ago",
    ageDays: 14,
    useCases: ["Reasoning", "Chat", "Code Generation"],
    providers: ["NVIDIA", "Together"],
  },
  {
    id: "llama-3.1-nemotron-70b",
    provider: "NVIDIA",
    logoColor: "bg-nv-green",
    name: "llama-3.1-nemotron-70b-instruct",
    description:
      "NVIDIA-tuned Llama variant aligned for helpfulness, ranking at the top of reward benchmarks for assistant tasks.",
    badges: ["free-endpoint", "downloadable"],
    partnerEndpoint: false,
    tags: ["Chat", "Aligned", "70B"],
    downloads: "3.1M",
    downloadsNum: 3_100_000,
    age: "1 month ago",
    ageDays: 30,
    useCases: ["Chat", "Reasoning"],
    providers: ["NVIDIA", "Hugging Face"],
  },
  {
    id: "llama-3.3-70b",
    provider: "Meta",
    logoColor: "bg-[#1d65c1]",
    name: "llama-3.3-70b-instruct",
    description:
      "Open multilingual instruction model delivering 405B-class quality at 70B cost, strong on chat and synthetic data.",
    badges: ["free-endpoint", "downloadable"],
    partnerEndpoint: false,
    tags: ["Chat", "Multilingual", "Open"],
    downloads: "5.4M",
    downloadsNum: 5_400_000,
    age: "3 months ago",
    ageDays: 92,
    useCases: ["Chat", "Retrieval (RAG)"],
    providers: ["NVIDIA", "Hugging Face", "Fireworks"],
  },
  {
    id: "deepseek-r1",
    provider: "DeepSeek",
    logoColor: "bg-[#4d6bfe]",
    name: "deepseek-r1",
    description:
      "Reinforcement-learned reasoning model that exposes its chain-of-thought, competitive with closed frontier models on math.",
    badges: ["free-endpoint", "downloadable"],
    partnerEndpoint: true,
    tags: ["Reasoning", "Math", "CoT"],
    downloads: "7.9M",
    downloadsNum: 7_900_000,
    age: "5 days ago",
    ageDays: 5,
    useCases: ["Reasoning", "Code Generation"],
    providers: ["NVIDIA", "Together", "Baseten"],
  },
  {
    id: "mixtral-8x22b",
    provider: "Mistral AI",
    logoColor: "bg-[#ff7000]",
    name: "mixtral-8x22b-instruct",
    description:
      "Sparse mixture-of-experts model with native function calling and a 64K context, efficient for high-throughput serving.",
    badges: ["downloadable"],
    partnerEndpoint: false,
    tags: ["MoE", "Function calling", "64K context"],
    downloads: "2.2M",
    downloadsNum: 2_200_000,
    age: "6 months ago",
    ageDays: 182,
    useCases: ["Chat", "Retrieval (RAG)"],
    providers: ["Hugging Face", "Fireworks"],
  },
  {
    id: "phi-4",
    provider: "Microsoft",
    logoColor: "bg-[#0a7bd1]",
    name: "phi-4",
    description:
      "Small 14B model trained heavily on synthetic data, punching far above its size on STEM reasoning and code.",
    badges: ["downloadable"],
    partnerEndpoint: false,
    tags: ["Small", "Reasoning", "14B"],
    downloads: "1.6M",
    downloadsNum: 1_600_000,
    age: "2 months ago",
    ageDays: 61,
    useCases: ["Reasoning", "Code Generation"],
    providers: ["Hugging Face", "Baseten"],
  },
  {
    id: "qwen2.5-coder-32b",
    provider: "Qwen",
    logoColor: "bg-[#6f3df6]",
    name: "qwen2.5-coder-32b-instruct",
    description:
      "Code-specialized model with repository-level understanding, fill-in-the-middle and 92-language coverage.",
    badges: ["free-endpoint"],
    partnerEndpoint: true,
    tags: ["Code Generation", "FIM", "32B"],
    downloads: "1.1M",
    downloadsNum: 1_100_000,
    age: "3 weeks ago",
    ageDays: 21,
    useCases: ["Code Generation", "Chat"],
    providers: ["NVIDIA", "Fireworks"],
  },
  {
    id: "gemma-2-27b",
    provider: "Google",
    logoColor: "bg-[#ea4335]",
    name: "gemma-2-27b-it",
    description:
      "Lightweight open model from the Gemini research line, tuned for safe, helpful on-device and server chat.",
    badges: ["downloadable"],
    partnerEndpoint: false,
    tags: ["Open", "Chat", "27B"],
    downloads: "980K",
    downloadsNum: 980_000,
    age: "4 months ago",
    ageDays: 122,
    useCases: ["Chat"],
    providers: ["Hugging Face", "Together"],
  },
  {
    id: "flux.1-dev",
    provider: "Black Forest Labs",
    logoColor: "bg-[#111111] ring-1 ring-nv-border-strong",
    name: "flux.1-dev",
    description:
      "12B rectified-flow transformer for text-to-image generation with state-of-the-art prompt adherence and typography.",
    badges: ["downloadable"],
    partnerEndpoint: false,
    tags: ["Image Generation", "12B", "Diffusion"],
    downloads: "4.7M",
    downloadsNum: 4_700_000,
    age: "1 week ago",
    ageDays: 7,
    useCases: ["Image Generation", "Visual Design"],
    providers: ["Hugging Face", "Baseten"],
  },
];
