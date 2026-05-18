# Model And Provider Spec

Model/provider selection should have a small core, then dumb renderers. Picker
components should not own fallback policy, provider availability policy, or
model ordering.

## Current Anchors

- [x] `packages/shared/src/model.ts`
- [x] `packages/app/src/model/ordering.ts`
- [x] `packages/app/src/model/provider-instances.ts`
- [x] `packages/app/src/model/provider-models.ts`
- [x] `packages/app/src/model/provider-state.ts`
- [x] `packages/app/src/model/selection.ts`
- [x] `packages/app/src/components/chat/picker/*`
- [x] `packages/app/src/components/settings/provider-*`

Inventory commands:

```bash
wc -l packages/app/src/model/*.ts packages/app/src/components/chat/picker/*.ts packages/app/src/components/chat/picker/*.tsx packages/app/src/components/settings/provider-*.ts packages/app/src/components/settings/provider-*.tsx packages/app/src/components/settings/settings-panels.tsx packages/app/src/components/chat/view/inline-message-edit-composer.tsx
rg -n "from \"(\\.\\./|.*)model/|from \".*provider-state|from \".*provider-models|from \".*provider-instances|from \".*selection|from \".*chat-selection|from \".*ordering" packages/app/src --glob '!*.test.*' --glob '!*.browser.*'
rg -n "resolveSelectableModel|normalizeModelSlug|defaultInstanceIdForDriver|DEFAULT_MODEL|getDefaultServerModel|resolveSelectableProvider|sortModelsForProviderInstance|sortProviderModelItems|modelOptionsByInstance|providerStatuses|serverProviders" packages/app/src/components packages/app/src/routes packages/app/src/app --glob '!*.test.*' --glob '!*.browser.*'
```

## Reference Shape

Upstream comparison:

- [x] `pi` keeps raw model catalogs, provider/API registry, app model registry,
      and user-facing model resolver as separate concepts.
- [x] `pi` treats provider plus model ID as the stable model identity and
      rejects ambiguous bare model matches.
- [x] opencode V2 keeps provider/model catalog mutation behind narrow catalog
      service hooks, then resolves inherited provider/model facts at read time.
- [x] Both references put availability, defaults, fallback, and missing-state
      policy in the model core rather than the UI.

Multi buckets:

- [x] Catalog source: server provider snapshots, settings custom models, and
      `@multi/shared/model` primitives.
- [x] Provider instance state:
      `packages/app/src/model/provider-instances.ts`.
- [x] Resolved model projection: `packages/app/src/model/selection.ts`.
- [x] Selection/fallback policy: `packages/app/src/model/selection.ts`.
- [x] Provider option/trait interpretation:
      `packages/app/src/model/provider-state.ts`.
- [x] Render-only surfaces: picker, traits picker, model rows, provider settings
      rows, and command palette grouping.

## Current Inventory

- [x] `packages/app/src/model/provider-instances.ts` owns provider-instance
      display normalization, enabled-state overlay from settings, and instance
      ordering. `resolveAppProviderModelState` is the only production caller for
      provider-entry normalization, so app selection paths build entries once
      through the resolver. The raw entry derivation helper is private to the
      module.
- [x] `packages/app/src/model/selection.ts` owns custom model normalization,
      hidden/model-order preferences, text-generation selection fallback, and
      per-instance model option lists. It also derives normalized model catalog
      rows with provider-instance display metadata, selected catalog item
      fallback for picker-like surfaces, and composer/chat selection priority
      across draft, active thread session, thread model selection, settings
      default, and project default. It is the current normalized resolver core.
- [x] `packages/app/src/model/provider-state.ts` owns provider option
      descriptor normalization for dispatch and traits rendering, including
      prompt-injected effort detection, provider-specific trait classification,
      section labels, trigger labels, and model capability labels.
- [x] `packages/app/src/model/ordering.ts` is currently the single ordering
      primitive used by picker, settings, and selection.
- [x] `packages/app/src/components/chat/picker/model-content.tsx` still owns
      rail/favorites filtering, search ranking application, and selected row
      key handling. It consumes resolver-derived catalog rows instead of
      rebuilding ready-provider filtering and provider metadata locally.
- [x] `packages/app/src/components/settings/provider-models-section.tsx` still
      owns custom model validation messages and settings row ordering controls.
- [x] `packages/app/src/components/settings/settings-panels.tsx` still owns
      provider-instance row assembly and text-generation model settings writes.
- [x] `packages/app/src/components/chat/view/chat-view.tsx` routes the status
      banner provider lookup through the app model resolver. Direct
      instance/model selection writes remain, but they resolve the chosen slug
      through the app model resolver before persisting draft state.
- [x] `packages/app/src/components/chat/composer/use-model-state.ts` does not
      exist. The composer model bridge is currently a private
      `useComposerModelState` hook inside
      `packages/app/src/components/chat/composer/input.tsx`.
- [x] `packages/app/src/components/chat/picker/icon-utils.ts` still exists as
      the picker icon/display-name helper. The stale provider-option export was
      deleted, but the file itself remains until caller inventory decides
      whether icon/display helpers belong in the picker component boundary.

## Current Contract Facts

- [x] `packages/contracts/src/model.ts` owns provider option/capability schema
      only. It must not publish provider model catalogs, shorthand aliases, or
      per-provider defaults; Cursor and other providers can update model lists
      through runtime discovery.
- [x] Provider option selections are keyed by `ProviderInstanceId`, not by
      `ProviderDriverKind`. Default instances happen to use the same slug as their
      driver, but custom instances do not.
- [x] `stores/chat-drafts.ts` still persists the legacy field name
      `modelSelectionByProvider`; its keys are `ProviderInstanceId`. Do not rename
      that persisted key without an explicit migration.
- [x] Picker model lists are keyed by `ProviderInstanceId` and model slug.
- [x] Picker model catalog rows are derived by the app model resolver surface,
      including provider-instance display metadata and ready-instance filtering.
- [x] Picker trigger display fallback is resolved by the app model catalog
      resolver, not by local first-option UI policy.
- [x] Settings favorites are keyed by `ProviderInstanceId` and model slug.
- [x] The normalized resolver return type has a discriminated
      availability result.
- [x] UI messages for missing provider, missing model, disabled provider, empty
      catalog, and loading are centralized on the resolver status contract.

## Target Core

The model core returns facts and discriminated outcomes.

- [x] `packages/shared/src/model.ts` owns runtime-neutral primitives such as
      model selection creation, option descriptor normalization, slug
      normalization, and prompt-effort prefix application.
- [x] Provider instances are normalized once from server config/provider status.
- [x] Model options are normalized once per provider instance by the app
      resolver state.
- [x] Active selection resolves to one discriminated result:
  - [x] `ready`
  - [x] `missing-provider`
  - [x] `missing-model`
  - [x] `disabled-provider`
  - [x] `empty-catalog`
  - [x] `loading`
- [x] Fallback selection is owned by the model core, not picker components.
- [x] Ordering is owned by the model core, not duplicated in settings, picker,
      composer, and command palette.
- [x] Provider traits/options are rendered from normalized descriptors; UI
      components do not inspect provider-specific option IDs except for display
      affordances explicitly declared by the descriptor.
- [x] App fallback, availability, ordering, and missing-state policy do not move
      into `@multi/shared/model`; they stay in the app model resolver.

## Component Responsibilities

Picker components may:

- [x] Render sections, search results, rows, empty states, and disabled states.
- [x] Call `onSelectionChange` with a normalized model selection.
- [x] Render provider skills in the slash menu.
- [x] Render provider/model details supplied by the core.

Picker components may not:

- [x] Decide fallback provider/model policy.
- [x] Know route-level defaults.
- [x] Patch missing models with hardcoded IDs.
- [x] Re-sort provider catalogs differently per surface.
- [x] Read server config directly when a normalized model state is already
      available from the core.

## Deletion Candidates

Classify before deleting:

- [x] `packages/app/src/model/ordering.ts` - keep only if it is the single
      ordering source. Public exports are the key/sort functions used by picker,
      settings, and selection; generic constraint interfaces stay private.
- [x] `packages/app/src/model/selection.ts` - keep only if it is the single
      provider/model resolver source.
- [x] `packages/app/src/model/provider-models.ts` - stale exported wrappers
      such as `getProviderModels`, `resolveSelectableProvider`, and
      `getDefaultServerModel` are deleted after caller inventory. Keep only
      label, interaction-mode, and capability helpers with production callers.
- [x] `packages/app/src/model/chat-selection.ts` - deleted after chat-specific
      handoff policy moved into `resolveAppProviderModelState`.
- [x] `packages/app/src/components/chat/picker/model-picker-model-highlights.ts`
  - deleted; the empty new-model chip list is private picker display policy in
    `model-content.tsx`.
- [x] `packages/app/src/components/chat/picker/model-search.ts` - deleted;
      search ranking is private picker behavior in `model-content.tsx`, with
      provider/name/fuzzy/favorite behavior covered by the picker browser suite.
- [x] `packages/app/src/components/command-palette-model.ts` - collapse if it is
      just another rendering of normalized model core output. Current inventory:
      not a provider/model-selection helper; it owns command palette actions,
      projects, threads, search grouping, and timestamps. Track any collapse in
      the delete inventory, not the model/provider cleanup.
- [x] `packages/app/src/components/settings/provider-status.ts` - deleted after
      caller inventory showed a single production consumer. Provider status copy
      and badge styles are now private display policy inside
      `provider-instance-card.tsx`.
- [x] `packages/app/src/components/settings/provider-driver-meta.ts` - keep as
      the provider settings metadata boundary, but collapse duplicate exported
      aliases. The public surface is `DriverOption`, `DRIVER_OPTIONS`, and
      `getDriverOption`; the lookup table stays private.
- [x] `packages/app/src/components/settings/provider-settings-form.tsx` - keep
      `ProviderSettingsForm` and `deriveProviderSettingsFields` public for the
      card/dialog boundary; field model and config read/write helpers are
      private to the form.
- [x] `packages/app/src/components/chat/composer/provider-registry.tsx` -
      deleted after caller inventory showed only `composer/input.tsx` plus a
      helper-only test. The render guard is private to the composer input; the
      actual provider trait controls stay in `picker/traits-picker.tsx`.
- [x] `packages/app/src/components/chat/composer/use-model-state.ts` - deleted
      after caller inventory showed only `composer/input.tsx`. The composer
      model state bridge is now a private hook inside the composer input, while
      provider/model fallback and dispatch option normalization remain owned by
      `model/selection.ts` and `model/provider-state.ts`.
- [x] `packages/app/src/model/provider-models.ts` - removed the exported
      composer-only interaction-mode toggle helper after caller inventory. The
      remaining exports are shared provider label formatting and model
      capability lookup.
- [x] `packages/app/src/model/provider-instances.ts` - made raw provider-entry
      derivation private; app callers consume the settings-aware normalized
      entry resolver.
- [x] `packages/app/src/components/chat/picker/icon-utils.ts` - deleted stale
      `AVAILABLE_PROVIDER_OPTIONS`; picker/sidebar provider choices come from
      resolver-derived provider instance entries.
- [x] Provider-state descriptor/input/output aliases and picker helper props are
      private unless another module imports the type by name. The exported
      provider-state type contract is currently `ProviderTraitsScope`.
- [x] Removed the exported `shouldRenderProviderTraitsScope` one-caller helper;
      composer scope gating reads normalized trait-state booleans locally.
- [x] `packages/app/src/components/chat/picker/status-banner.tsx` - deleted
      after caller inventory showed only `chat-view.tsx`; provider status banner
      rendering now lives at the chat view surface that displays it.

## Current Follow-Up Inventory

These are not deletion decisions. Re-run caller inventory before editing.

- [ ] `resolveProviderDriverKindForInstanceSelection` in
      `model/provider-instances.ts` has one production caller in
      `model/selection.ts` and should become private or be inlined if the
      resolver reads the provider entry directly.
- [ ] `deriveProviderInstanceEntriesForSettings` and
      `sortProviderInstanceEntries` in `model/provider-instances.ts` currently
      feed the app resolver. Keep exported only if a second production boundary
      imports them.
- [ ] `getProviderBooleanTraitSectionLabel` and
      `getProviderTraitsTriggerLabel` in `model/provider-state.ts` currently
      feed `traits-picker.tsx`. Decide whether labels are provider-state policy
      or picker-local display copy.
- [ ] `getProviderModelCapabilityLabels` in `model/provider-state.ts` currently
      feeds `provider-models-section.tsx`. Decide whether capability labels are
      provider-state policy or settings-local display copy.
- [ ] `sortProviderModelItems` in `model/ordering.ts` currently feeds
      `chat/picker/model-content.tsx`. Keep only if ordering remains a shared
      model primitive across picker and settings.
- [ ] `ProviderModelsSection`, `ProviderInstanceCard`, and
      `AddProviderInstanceDialog` are exported component boundaries with one
      production caller each. Keep them as component slots if settings remains
      split; do not treat them as helper files.
- [ ] Add browser coverage for the full provider settings panel, add-provider
      dialog, provider instance card, and provider settings schema form before
      collapsing settings components.

## Done Means

- [x] One public model resolver owns availability, fallback, ordering, and
      current selection.
- [x] Picker/settings/command palette tests assert behavior through UI or the
      resolver contract, not duplicate helper internals. Picker helper-only
      search tests are deleted; command-palette helper tests remain tracked by
      the general delete inventory. Current evidence:
      `provider-model-picker.browser.tsx` covers resolver fallback, missing,
      disabled, empty, search, favorites, and provider-instance behavior;
      `provider-models-section.browser.tsx` covers settings custom-model
      validation plus favorite/hidden model row actions; `command-palette-model`
      tests cover command palette thread/action grouping and are not
      provider/model resolver tests.
- [x] No root-level `model-ordering.ts`, `model-selection.ts`, or equivalent
      files exist outside `packages/app/src/model`.
- [x] Missing/disabled provider states render consistent user-facing messages in
      composer, picker, and settings.
- [x] `pnpm run typecheck` passes.

## First Work Items

- [x] Key provider option selections by `ProviderInstanceId` in chat selection,
      composer traits, and plan implementation handoff.
- [x] Add a resolver contract section to `provider-state.ts` or a replacement
      one-file model core.
- [x] Route chat/composer selection through the normalized resolver contract
      instead of rebuilding option-map and fallback policy locally.
- [x] Route settings text-generation selection through the normalized resolver
      contract and delete unused exported resolver wrappers.
- [x] Remove unused exports from provider/model helper files after caller
      inventory.
- [x] Inline the single-caller composer model-state hook into the composer input
      boundary.
- [x] Remove single-caller exports from provider instance/model helper modules
      after caller inventory.
- [x] Update picker tests to cover discriminated missing/disabled states.
- [x] Remove UI fallback branches after the resolver owns them.
- [x] Move picker catalog flattening and ready-provider filtering behind the app
      model core.
- [x] Route the chat view provider-status banner through the app model resolver
      instead of resolving status by driver kind.
- [x] Move picker trigger fallback selection behind the app model catalog
      resolver.
- [x] Delete the old chat pre-resolution fallback helper and stale provider
      model exports after caller inventory.
- [x] Reuse normalized provider entries across chat selection and final app
      resolver handoff instead of normalizing the same provider list twice.
- [x] Move provider trait visibility, section labels, trigger labels, and
      model capability labels behind `provider-state.ts`.
- [x] Inline one-callsite picker search/highlight helper files into the picker
      component boundary and remove their helper-only unit test.
- [x] Classify command-palette model helpers: not provider/model resolver
      output; leave collapse/delete decisions to the general delete inventory.
- [x] Add one browser test that changes viewport and verifies model selector
      placement does not overflow the composer.
