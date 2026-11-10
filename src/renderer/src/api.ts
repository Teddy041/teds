import { useEffect, useState } from "react";
import type { PublicState } from "../../shared/types";
import { locale } from "../../shared/i18n";

// Ana süreçle konuşan ince katman. Tüm işlemler window.teds.call ile yapılır.

export interface Frame {
  botId: string;
  data: string;
  url: string;
  title: string;
  width: number;
  height: number;
  dipW: number;
  dipH: number;
  loading: boolean;
}

declare global {
  interface Window {
    teds: {
      call: (name: string, ...args: unknown[]) => Promise<unknown>;
      onState: (fn: (s: PublicState) => void) => () => void;
      onFrame: (fn: (f: Frame) => void) => () => void;
    };
  }
}

export function call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  return window.teds.call(name, ...args) as Promise<T>;
}

export function useAppState(): PublicState | null {
  const [s, setS] = useState<PublicState | null>(null);
  useEffect(() => {
    const off = window.teds.onState(setS);
    void call<PublicState>("getState").then(setS);
    return off;
  }, []);
  return s;
}

export const uid = () => Math.random().toString(36).slice(2, 14);

export function timeAgo(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
}
