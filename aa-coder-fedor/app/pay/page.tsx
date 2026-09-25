import { Suspense } from "react";

import { PayApp } from "@/components/pay-app";

export default function PayRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-[#070b12] text-zinc-500">
          Тарифы…
        </div>
      }
    >
      <PayApp />
    </Suspense>
  );
}
