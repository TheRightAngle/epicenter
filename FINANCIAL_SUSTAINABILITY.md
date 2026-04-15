# How Epicenter Stays Open and Financially Sustainable

I've been thinking a lot about the right way to make Epicenter sustainable while staying true to our roots in transparency, openness, and open source.

Epicenter is a set of local-first apps that share your data through CRDTs (notes, transcripts, chat histories, all in one folder you control). The library that powers this is something other developers can build on too. To keep working on this seriously, we need a way to sustain it that doesn't compromise the openness.

We originally considered dual licensing: offer the whole project under AGPL, and sell a commercial license for companies that want to avoid copyleft obligations. But the projects we were modeling after don't actually do this. [Cal.com](https://github.com/calcom/cal.com) and [dub.sh](https://github.com/dubinc/dub) are just AGPL with hosted SaaS, no commercial license option. [Bitwarden](https://github.com/bitwarden/server) is closer: an AGPL server with proprietary enterprise modules under a separate "Bitwarden License." None of them dual-license, and none of them require a CLA.

So we landed on split licensing with an open-core model. The library packages and apps are MIT, completely free for anyone to use however they want. The sync server is AGPL-3.0, which means anyone hosting a modified version has to share their changes. [Yjs](https://github.com/yjs/yjs), the CRDT library Epicenter is built on, does the same thing: the core library (as well as the client-side providers like y-websocket, y-webrtc, and y-indexeddb) are all MIT, but [y-redis](https://github.com/yjs/y-redis), the server-side scaling backend, is AGPL. [Liveblocks](https://github.com/liveblocks/liveblocks) follows a similar pattern (Apache client libraries, AGPL server), and so does [Bitwarden](https://github.com/bitwarden/server) (GPL clients, AGPL server, proprietary enterprise modules). The line is the same everywhere: client code is permissive, server infrastructure is copyleft.

Epicenter Cloud will be the primary way we sustain the project: hosted sync infrastructure so you don't have to run your own server. Think [Supabase](https://github.com/supabase/supabase) selling hosted Postgres, or Liveblocks selling hosted collaboration. Enterprise features like team management, SSO, and admin dashboards will live in a separate proprietary directory, written entirely by the Epicenter team. For organizations that want to self-host the AGPL server, we'll offer support contracts.

To me, this feels like the right trade. The library packages are MIT because I want as many developers as possible building with Epicenter, no strings, no friction. The sync server is AGPL because that's the infrastructure someone would need to compete with Epicenter Cloud, and it's fair to ask that modifications to it stay open. Everything a developer touches day-to-day is permissive. The commercially relevant infrastructure is copyleft. And the premium features that fund development are proprietary.

We have other options if that doesn't work, of course. We could pursue a traditional SaaS business around our apps, or go deeper into B2B enterprise memory. But the open-core model is my favorite. It keeps the project as open as possible while building something financially sustainable.

## The split

MIT: `packages/workspace`, `packages/ui`, `packages/svelte-utils`, `packages/constants`, `packages/ai`, `packages/cli`, `packages/filesystem`, `packages/sync-client`, and all apps except the sync server.

AGPL-3.0: `apps/api` (sync server) and `packages/sync` (sync protocol).

Each package has its own LICENSE file. See the root [LICENSE](LICENSE) for the full breakdown.
