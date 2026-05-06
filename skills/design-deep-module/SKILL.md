---
name: design-deep-module
description: "Enforce the 'deep module' design pattern (Ousterhout, A Philosophy of Software Design) when designing or reviewing the shape of a module, class, package, service, or API. Activate for verbs like design, architect, scaffold, sketch, propose, structure, refactor, split, extract, or review when the noun is module, class, package, component, service, library, SDK, API, interface, or abstraction. Triggers on phrases like 'design a module for X', 'how should I structure this class', 'what should the interface look like', 'split this into modules', 'is this abstraction good', and on file-creation requests for new top-level modules, public APIs, or service boundaries. Ensures the module has a narrow interface relative to its functionality, hides implementation details, avoids pass-through and shallow wrappers, and pulls complexity downward."
---

# design-deep-module

Guides the design of modules so they end up *deep*: a small, simple interface that hides a large amount of functionality and complexity. Based on John Ousterhout's *A Philosophy of Software Design*. Use this whenever a new module/class/API seam is being drawn, or when reviewing whether an existing one is pulling its weight.

## When to activate

Activate this skill whenever the user:

- asks to design, architect, scaffold, propose, or sketch a new module, class, package, component, service, library, or API
- asks "how should I structure / split / organize" code into modules or layers
- asks for a review of a module seam, interface, or abstraction ("is this abstraction good?", "should I split this?")
- proposes a new public interface, SDK surface, or service seam
- introduces a wrapper, facade, or adapter and asks whether it earns its keep
- refactors by extracting a class/module and wants to validate the extraction

Do NOT activate when the user is implementing logic *inside* an already-agreed module seam, fixing a bug that doesn't change the interface, doing pure formatting/renaming, or asking general questions about software philosophy without an actual module to design.

## Pattern

A *deep* module has a **simple interface** relative to its **powerful functionality**. Picture a rectangle: width = interface surface area, height = hidden functionality. Deep modules are tall and narrow. Shallow modules are short and wide — their interface is almost as complex as what they do, so they impose cost without buying abstraction.

```text
Deep (good)              Shallow (bad)
┌──┐                     ┌──────────────┐
│IF│  small interface    │  IF (wide)   │
├──┤                     ├──────────────┤
│  │                     │  impl (thin) │
│  │  rich               └──────────────┘
│  │  hidden
│  │  functionality
└──┘
```

Rules to enforce when designing or reviewing a module:

- **Narrow interface, deep implementation.** The public surface (methods, params, exceptions, config knobs, types it forces callers to know) should be small. The work it does behind that surface should be substantial. If the interface is nearly as complex as the implementation, the module is shallow — inline it or merge it.
- **Hide information aggressively.** Internal data structures, algorithms, formats, protocols, and dependencies must not leak through the interface. A caller should be able to use the module without learning how it works. Configuration that exposes internals is a leak.
- **General-purpose over special-purpose.** Prefer one method that handles a class of problems over many methods each handling one variant. "Somewhat general-purpose" is the sweet spot — designed for today's needs but expressed in terms that fit tomorrow's.
- **No pass-through methods.** A method that does nothing but call another method with the same signature is a red flag: it widens the interface without adding abstraction. Either the wrapper should add real behavior, or callers should talk to the inner module directly.
- **No pass-through variables / config.** Threading a parameter through many layers just to deliver it to the bottom is a shallow-decomposition smell. Use context objects, dependency injection, or move state closer to where it's used.
- **Errors defined out of existence.** Don't expose an error or edge case the caller must handle if you can absorb it inside the module (e.g. `delete()` on a missing file = success, not error). Each exception in the interface widens the interface.
- **Different layer = different abstraction.** If a module's public methods read like its internal implementation in disguise, the layer isn't earning its keep. Each layer should re-cast the problem in simpler terms than the layer below.
- **Decompose by abstraction, not by execution order.** Avoid carving modules along temporal boundaries ("first do X, then Y, then Z" → three modules). Carve along *what knowledge each part needs to hold*. Temporal decomposition tends to produce shallow modules that all touch the same data.
- **Comments at the interface describe *what*, not *how*.** If the docstring has to explain implementation to be useful, the abstraction is leaking. The interface comment should let a caller use the module without reading the body.

Bad — shallow wrapper, pass-through, leaked internals:

```python
class UserStore:
    def __init__(self, db_conn, cache_client, retry_count, timeout_ms):
        ...
    def get_user_from_db(self, id): ...
    def get_user_from_cache(self, id): ...
    def get_user_with_fallback(self, id, use_cache, use_db, raise_on_missing): ...
```

Caller must know there's a cache, a DB, retry semantics, and fallback policy — the module exposes its mechanism instead of hiding it.

Good — deep, narrow interface:

```python
class UserStore:
    def __init__(self, config: UserStoreConfig): ...
    def get(self, id: UserId) -> User | None: ...
    def put(self, user: User) -> None: ...
```

Caching, retries, DB choice, and fallback live behind `get`/`put`. The caller sees the *what*, never the *how*.

### Language

Shared vocabulary for every suggestion this skill makes. Use these terms exactly — don't substitute "component," "service," "API," or "boundary." Consistent language is the whole point.

#### Terms

**Module**
Anything with an interface and an implementation. Deliberately scale-agnostic — applies equally to a function, class, package, or tier-spanning slice.
_Avoid_: unit, component, service.

**Interface**
Everything a caller must know to use the module correctly. Includes the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics.
_Avoid_: API, signature (too narrow — those refer only to the type-level surface).

**Implementation**
What's inside a module — its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Reach for "adapter" when the seam is the topic; "implementation" otherwise.

**Depth**
Leverage at the interface — the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface. A module is **shallow** when the interface is nearly as complex as the implementation.

**Seam** _(from Michael Feathers)_
A place where you can alter behaviour without editing in that place. The *location* at which a module's interface lives. Choosing where to put the seam is its own design decision, distinct from what goes behind it.
_Avoid_: boundary (overloaded with DDD's bounded context).

**Adapter**
A concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).

**Leverage**
What callers get from depth. More capability per unit of interface they have to learn. One implementation pays back across N call sites and M tests.

**Locality**
What maintainers get from depth. Change, bugs, knowledge, and verification concentrate at one place rather than spreading across callers. Fix once, fixed everywhere.

#### Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable, swappable parts — they just aren't part of the interface. A module can have **internal seams** (private to its implementation, used by its own tests) as well as the **external seam** at its interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, the module wasn't hiding anything (it was a pass-through). If complexity reappears across N callers, the module was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

#### Relationships

- A **Module** has exactly one **Interface** (the surface it presents to callers and tests).
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

#### Rejected framings

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout): rewards padding the implementation. We use depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword or a class's public methods**: too narrow — interface here includes every fact a caller must know.
- **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.

## Workflow

Use these steps when designing a new module or reviewing a proposed one. They are diagnostic — answer them honestly; if any answer is "no" or "I can't tell", the module is probably shallow and should be reshaped before code is written.

1. **State the module's purpose in one sentence.** If it takes more, the module is doing too much or its abstraction isn't crisp yet. Refine the sentence first.
2. **List the public interface.** Every method, every parameter, every exception, every config field, every type the caller must import. This is the "width" — keep it visible while you work.
3. **List what the module hides.** Algorithms, data structures, external services, file formats, protocols, threading, caching, retries. This is the "depth". If this list is short or nearly the same shape as the interface, stop — the module is shallow.
4. **Check the depth ratio.** Read interface and hidden-functionality side by side. The interface should feel disproportionately small. If they look balanced, decide: inline the module, merge it with a neighbor, or push more responsibility into it.
5. **Hunt for shallow-module smells.** Walk the interface and flag: pass-through methods, pass-through parameters, leaked internal types, exceptions the caller could ignore, config knobs that name internal mechanisms, method names that describe *how* instead of *what*, temporal decomposition across sibling modules.
6. **Fix the smells before writing code.** For each smell, choose: absorb the concern (define errors out of existence, hide the type, drop the knob), merge with another module, or rename so the abstraction reads at the right layer. Re-run step 4.
7. **Write the interface comments.** Before any implementation, write the docstring/JSDoc for each public method as if the reader has never seen the module. If you can't write a useful comment without describing internals, the abstraction is still wrong — return to step 4.
8. **Hand off to implementation.** Only once the interface is narrow, hides real complexity, and reads cleanly at its layer. The skill's job ends here; implementation proceeds normally.
