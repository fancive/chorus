"use client";

import { nanoid } from "nanoid";

const TOKEN_KEY = "chorus.browserToken";
const NICK_KEY = "chorus.nickname";

export function getOrCreateBrowserToken(): string {
  if (typeof window === "undefined") return "";
  let t = window.localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = nanoid(24);
    window.localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export function getNickname(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICK_KEY) || "";
}

export function setNickname(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NICK_KEY, name);
}
