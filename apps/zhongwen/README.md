# Zhongwen

Bilingual Chinese-English chat app for learning Mandarin. Users ask questions in English; the AI responds with mixed English and Chinese. The client automatically annotates Chinese characters with pinyin using `<ruby>` tags—the system prompt tells the AI to never include pinyin itself.

## How it works

**Chat streaming**: Each conversation gets a `ChatClient` (from `@tanstack/ai-client`) that streams SSE responses from `${APP_URLS.API}/ai/chat`. Provider, model, and system prompt are sent as request body data. The server uses TanStack AI's `chat()` with the requested provider adapter. Messages come back as `UIMessage` objects with `TextPart`s.

**Markdown + pinyin**: Assistant messages are parsed with `marked` (GFM, breaks enabled) into HTML, then `annotateHtml()` in `src/lib/pinyin/annotate.ts` walks text nodes (splitting on HTML tags via regex) and wraps CJK runs with `<ruby>` pinyin tags using `pinyin-pro`. Output is sanitized with DOMPurify (allowing ruby/rt/rp), memoized via `$derived` in `AssistantMessagePart.svelte`, and rendered via `{@html}` inside `<div class="prose prose-sm">`.

**State management**: `createChatState()` in `src/lib/chat/chat-state.svelte.ts` is a Svelte 5 factory using `$state`/`$derived` and `SvelteMap`. Each conversation gets a "handle" wrapping its `ChatClient` with reactive getters for messages, isLoading, error, and inputValue. A `$derived` `metadata` reference eliminates repeated array lookups. The singleton `chatState` export is the app's central state.

**Auth**: Google OAuth via Better Auth. Token stored in localStorage via `createTokenStore('zhongwen')`, passed as Bearer header to the API.

**Providers**: `src/lib/chat/providers.ts` maps provider names to model lists imported from `@tanstack/ai-{openai,anthropic,gemini,grok}`. Default is OpenAI. Provider/model is per-conversation and configurable in the UI.

## File map

```
src/
  routes/
    +page.svelte          # Main layout: sidebar + chat area + pinyin toggle
    +layout.svelte         # Root layout with Toaster
    +layout.ts             # SSR disabled (CSR only)
  lib/
    auth.ts                # Token store + auth state (Google OAuth)
    chat/
      chat-state.svelte.ts # Reactive multi-conversation state (core of the app)
      providers.ts         # Provider/model config from TanStack AI packages
      system-prompt.ts     # AI instructions (mix languages, no pinyin, simplified only)
    components/
      ChatMessage.svelte       # Renders UIMessage; delegates assistant parts to AssistantMessagePart
      AssistantMessagePart.svelte # Markdown parse + pinyin annotate + DOMPurify, memoized via $derived
      ChatInput.svelte         # Textarea + send button, Enter to submit
      ConversationList.svelte  # Sidebar conversation list with create/switch
    pinyin/
      annotate.ts              # annotateHtml(): CJK detection and ruby annotation in HTML strings
```

## Key decisions

- Conversations are in-memory only, not persisted.
- SSR is disabled; the app is CSR-only.
- The system prompt forbids pinyin in AI responses so the client can control annotation rendering and toggle visibility.
- Simplified from tab-manager's chat-state: no Y.Doc, no tool calls.

## Scripts

```sh
bun run dev        # Start dev server
bun run build      # Production build
bun run preview    # Preview production build
bun run typecheck  # svelte-check
```
