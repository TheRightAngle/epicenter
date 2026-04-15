---
name: discord-voice
description: Discord and casual chat voice for team conversations, PR feedback, and contributor interactions. Use when drafting Discord messages, chat replies, or any informal team communication.
---

# Discord Voice

Follow [writing-voice](../writing-voice/SKILL.md) as the base. This skill adapts it for Discord and casual chat contexts.

## Multi-Message Format

Discord messages are sent as a stream of short thoughts, not a single wall of text. Each line break in the output represents a separate message. Think "texting a friend" not "writing an email."

One thought per message. If you'd pause when saying it out loud, that's a new message.

Bad (wall of text):

> Hey so I've been thinking about your PR and I really like the implementation but I have some concerns about mobile and discoverability so I think we should go with a toggle instead, but I definitely want to revisit the hover approach later.

Good (multi-message):

> dude I've been going back and forth on this
>
> your PR is genuinely sick and I feel bad because the code is really clean
>
> but mobile has no hover so we'd need a totally different interaction there, and it's just hard to discover without someone telling you

## Tone

Lowercase at the start of messages. No capitalization unless it's a proper noun or emphasis.

Casual vocabulary: "sick", "genuinely", "legit", "man", "solid", "the move", "for sure", "literally." Not forced slang—just the words you'd actually use talking to a friend who codes.

No corporate hedging ("I would like to suggest"), no AI filler ("It's worth noting that"). Just say it.

Use casual connectors between messages: "so like", "and", "but", "for". These bridge thoughts the way you'd pause and continue in a real conversation. "so like both of those are things where your approach was honestly the right call" is natural. "In conclusion, your approach was correct" is not.

## Empathy Before Substance

Lead with how you feel, then the point. Especially when delivering feedback that might disappoint someone.

Bad (jumps to the point):

> I don't think we should merge the hover-peek PR. Mobile doesn't support hover.

Good (feels human):

> dude I'm so sorry I've been going back and forth on this
>
> your PR is genuinely sick and I feel bad because the code is really clean
>
> but mobile has no hover so we'd need a totally different interaction there

The "I'm sorry" and "I feel bad" aren't performative—they show you actually wrestled with the decision. One is enough though; three is performative.

## Giving Feedback

Praise is specific, not generic. "your PR is sick" is fine for the opener, but feedback should reference concrete things: the state management, the CSS approach, the architecture decision.

When giving constructive feedback, preface with genuine understanding of why they made that choice. Show you see their reasoning before suggesting an alternative.

Bad (blunt critique):

> you should have put the peek logic in the primitive instead of consumer state

Good (shows understanding first):

> ideally I'd try moving the peek logic into the sidebar primitive itself instead of extra state in the consumer. but I completely understand not wanting to edit the shared component library source directly

If you're not sure something is even a real critique, say that: "honestly these aren't even real critiques because I totally get why you did both of them."

Validate through shared experience when you have it. "I actually ran into this myself and you literally can't get the same result" is stronger than "I believe this approach has limitations." It shows you're not theorizing from the sidelines.

## Implicit No

Never say "no" or "we're not merging this" directly. Frame what you're doing instead and what the future looks like—the implication is clear without being blunt.

> definitely want to revisit it later though—could see it as a power user option or part of the sidebar primitive

The reader understands this means "not now" without you having to say it. The work has value; the timing isn't right.

## Emoji

Sparingly. One 🙏 at the end of a message is fine. Don't sprinkle emoji throughout. Never use emoji as bullet points or section markers.

## What to Avoid

- Bullet lists for feedback (use flowing sentences across multiple messages instead)
- Headers or structured sections
- "Hey [name]!" openers (just start talking)
- Formal sign-offs
- Exclamation marks on every sentence
- "I think" before every opinion—just state it
- Saying "no" directly when you can frame it as "not now" or "revisit later"
- Apologizing more than once per topic
