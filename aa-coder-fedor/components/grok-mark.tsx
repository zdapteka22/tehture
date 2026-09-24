"use client";

export function GrokMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M16 1.6 19.7 12.3 30.4 16 19.7 19.7 16 30.4 12.3 19.7 1.6 16 12.3 12.3 16 1.6Z" />
    </svg>
  );
}

/** Live = rotating Ultima mark. Idle = still, dim. */
export function WorkMark({
  live,
  size = "md",
}: {
  live: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "lg" ? "size-11" : size === "sm" ? "size-7" : "size-9";
  const star = size === "lg" ? "size-5" : size === "sm" ? "size-3.5" : "size-4";
  return (
    <span
      className={`relative inline-flex ${box} shrink-0 items-center justify-center`}
      title={live ? "Кодер сейчас что-то делает — смотрите строку над чатом" : "Готов к задаче"}
      aria-label={live ? "Кодер сейчас что-то делает" : "Готов к задаче"}
    >
      <span
        className={`absolute inset-0 rounded-full border ${
          live ? "border-[#b48eff]/70 ultima-orbit" : "border-white/10"
        }`}
      />
      <span
        className={`absolute inset-1 rounded-full border border-dashed ${
          live ? "border-[#6ee7b7]/50 ultima-orbit-rev" : "border-transparent"
        }`}
      />
      <GrokMark className={`${star} ${live ? "text-[#e8dcff] ultima-spin" : "text-[#6a6a72]"}`} />
    </span>
  );
}
