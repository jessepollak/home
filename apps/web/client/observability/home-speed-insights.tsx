"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { filterSpeedInsightsEvent } from "./speed-insights";

export function HomeSpeedInsights() {
  return <SpeedInsights sampleRate={1} beforeSend={filterSpeedInsightsEvent} />;
}
