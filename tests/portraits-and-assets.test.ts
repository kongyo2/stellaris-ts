import { describe, expect, it } from "vitest";

import { define } from "../src/builders/index.js";
import { defineMod, emit, entries, raw, repeated, type Mod } from "../src/index.js";
import { validate, type ValidationDiagnostic } from "../src/validate/index.js";
import { vanillaModsCompatibilityVersion } from "../src/generated/vanilla/game-version.js";

/** What this build of the game asks a mod to declare, so no test pins one release. */
const SUPPORTED_VERSION = `v${vanillaModsCompatibilityVersion}.*`;

const mod = (): Mod => defineMod({ name: "Portraits", version: "1", supportedVersion: SUPPORTED_VERSION });

/** The diagnostics one code produced, as `definition.path`. */
const reported = (target: Mod, code: string): readonly string[] =>
  validate(target)
    .filter((diagnostic: ValidationDiagnostic) => diagnostic.code === code)
    .map((diagnostic) =>
      diagnostic.path.length === 0 ? diagnostic.definition : `${diagnostic.definition}.${diagnostic.path}`,
    );

const messages = (target: Mod, code: string): readonly string[] =>
  validate(target)
    .filter((diagnostic) => diagnostic.code === code)
    .map((diagnostic) => diagnostic.message);

/**
 * Since 4.0 a species class gets its portraits from `common/portrait_sets`,
 * and the empire designer shows them by `common/portrait_categories`. Both are
 * read by readers of their own (`0x447e80`, `0x44e1b0`), which log a species
 * class, a portrait or a set they cannot find.
 */
describe("portrait sets and categories", () => {
  it("can be written with define, in the directories the game reads them from", () => {
    expect(define("portrait_set", "sts_set", { species_class: "MAM" }).directory).toBe("common/portrait_sets");
    expect(define("portrait_category", "sts_category", { sets: ["mammalians"] }).directory).toBe(
      "common/portrait_categories",
    );
  });

  it("checks the species class, each portrait and each set it names", () => {
    const target = mod()
      .add(
        define("portrait_set", "sts_set", {
          species_class: "NO_SUCH_CLASS",
          portraits: ["mam5", "human", "sts_no_such_portrait"],
          conditional_portraits: { playable: { always: true }, portraits: ["sts_nor_this_one"] },
        }),
      )
      .add(define("portrait_category", "sts_category", { name: "MAM", sets: ["sts_set", "sts_no_such_set"] }));
    const unresolved = messages(target, "unresolved-reference");

    expect(unresolved).toHaveLength(4);
    expect(unresolved.some((message) => message.includes("species_class NO_SUCH_CLASS"))).toBe(true);
    // `mam5` is a portrait and `human` a portrait group: either will do.
    expect(unresolved.some((message) => message.includes("mam5") || message.includes(" human"))).toBe(false);
    expect(unresolved.some((message) => message.includes("portrait or portrait_group sts_no_such_portrait"))).toBe(
      true,
    );
    expect(unresolved.some((message) => message.includes("sts_nor_this_one"))).toBe(true);
    expect(unresolved.some((message) => message.includes("portrait_set sts_no_such_set"))).toBe(true);
  });

  it("needs a species class", () => {
    expect(
      reported(mod().add(define("portrait_set", "sts_set", entries([["portraits", ["mam5"]]]))), "missing-field"),
    ).toEqual(["sts_set"]);
  });

  it("reports a condition written twice in one conditional_portraits", () => {
    const twice = mod().add(
      define("portrait_set", "sts_set", {
        species_class: "MAM",
        conditional_portraits: {
          playable: repeated({ has_aquatics: true }, { has_toxoids: true }),
          portraits: ["mam5"],
        },
      }),
    );
    const once = mod().add(
      define("portrait_set", "sts_set", {
        species_class: "MAM",
        conditional_portraits: repeated(
          { playable: { has_aquatics: true }, portraits: ["mam5"] },
          { playable: { has_toxoids: true }, portraits: ["mam4"] },
        ),
      }),
    );

    expect(reported(twice, "duplicate-field")).toEqual(["sts_set.conditional_portraits"]);
    expect(reported(once, "duplicate-field")).toEqual([]);
  });

  it("pairs uplifted portraits with portraits by position", () => {
    const short = mod().add(
      define("portrait_set", "sts_set", {
        species_class: "PRE_MAM",
        portraits: ["mam5", "mam4"],
        uplifted_portraits: ["mam6"],
      }),
    );
    const paired = mod().add(
      define("portrait_set", "sts_set", {
        species_class: "PRE_MAM",
        portraits: ["mam5", "mam4"],
        uplifted_portraits: ["mam6", "mam13"],
      }),
    );

    expect(messages(short, "missing-uplifted-portrait")[0]).toContain("mam4");
    expect(reported(paired, "missing-uplifted-portrait")).toEqual([]);
  });

  it("tells a species class that still lists portraits where they went", () => {
    const target = mod().add(
      define("species_class", "STS", {
        archetype: "BIOLOGICAL",
        graphical_culture: "mammalian_01",
        portraits: ["mam5"],
      }),
    );
    const unknown = messages(target, "unknown-field");

    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toContain("portraits is not a key");
    expect(unknown[0]).toContain("portrait_set");
  });
});

/**
 * Each entry of `common/species_names` is written under a name of the author's
 * choosing, and the rule that takes any key says what the entry holds. The
 * block itself is written under the species class the names belong to.
 */
describe("species names", () => {
  const names = (key: string, entry: Record<string, string>) =>
    mod()
      .add(define("species_name", key, { sts_entry: entry }))
      .localise("l_english", "sts_name", "Name")
      .localise("l_english", "sts_plural", "Names");

  it("checks the name list an entry draws from", () => {
    // The file is `AQU1.txt`; the name list it defines is `AQUATIC1`.
    expect(
      messages(names("AQUATIC", { name: "sts_name", plural: "sts_plural", name_list: "AQU1" }), "unresolved-reference"),
    ).toEqual(["name_list points at name_list AQU1, which is neither in vanilla nor defined by this mod."]);
    expect(
      reported(
        names("AQUATIC", { name: "sts_name", plural: "sts_plural", name_list: "AQUATIC1" }),
        "unresolved-reference",
      ),
    ).toEqual([]);
  });

  it("looks up the strings an entry names", () => {
    const target = mod().add(
      define("species_name", "AQUATIC", {
        sts_entry: { name: "sts_missing", plural: "sts_missing_pl", name_list: "AQUATIC1" },
      }),
    );

    expect(reported(target, "missing-localisation")).toEqual(["AQUATIC.sts_entry", "AQUATIC.sts_entry"]);
  });

  it("reports a key an entry does not take", () => {
    const target = names("AQUATIC", {
      name: "sts_name",
      plural: "sts_plural",
      name_list: "AQUATIC1",
      namelist: "AQUATIC1",
    });

    expect(reported(target, "unknown-field")).toEqual(["AQUATIC.sts_entry"]);
  });

  it("is written under a species class", () => {
    expect(
      reported(
        names("STS_NO_CLASS", { name: "sts_name", plural: "sts_plural", name_list: "AQUATIC1" }),
        "unresolved-reference",
      ),
    ).toEqual(["STS_NO_CLASS"]);
    const own = names("STS_CLASS", { name: "sts_name", plural: "sts_plural", name_list: "AQUATIC1" }).add(
      define("species_class", "STS_CLASS", { archetype: "BIOLOGICAL", graphical_culture: "mammalian_01" }),
    );

    expect(reported(own, "unresolved-reference")).toEqual([]);
  });
});

/**
 * A file a definition names is looked for among the game's files and the
 * mod's: a mesh (`pdxmeshtype.cpp:139`), a portrait's textures
 * (`portraits.cpp:586`), a sprite's texture. An animation's is looked for
 * beside the file that declares it (`assetfactory.cpp:1078`).
 */
describe("files a definition names", () => {
  const mesh = (file: string) => define("model_mesh", "sts_mesh", { file }, { file: "portraits/sts/sts_meshes.gfx" });

  it("reports a mesh, a texture and a sprite's texture nothing ships", () => {
    const target = mod()
      .add(mesh("gfx/models/portraits/sts/missing.mesh"))
      .add(
        define("portrait", "sts_portrait", {
          entity: "humanoid_05_female_01_entity",
          clothes_selector: "no_texture",
          attachment_selector: "no_texture",
          character_textures: ["gfx/models/portraits/sts/missing.dds"],
        }),
      )
      .add(
        define("sprite", "GFX_sts_icon", { textureFile: "gfx/interface/icons/sts_missing.dds" }, { as: "spriteType" }),
      );

    expect(reported(target, "missing-file")).toEqual(["GFX_sts_icon", "sts_mesh", "sts_portrait"]);
  });

  it("finds a file the mod ships, whatever case its path is written in, and one of the base game's", () => {
    const shipped = mod().add(mesh("gfx/models/portraits/sts/Body.mesh"));
    shipped.asset("gfx/models/portraits/sts/body.mesh", new Uint8Array());
    const vanilla = mod().add(mesh("gfx/models/portraits/biogenesis/bio_01_portrait_01_f_01.mesh"));

    expect(reported(shipped, "missing-file")).toEqual([]);
    expect(reported(vanilla, "missing-file")).toEqual([]);
  });

  it("does not count the base game's files in a directory the mod replaces", () => {
    const replacing = (): Mod =>
      defineMod({
        name: "Portraits",
        version: "1",
        supportedVersion: SUPPORTED_VERSION,
        replacePaths: ["gfx/models/portraits/biogenesis"],
      }).add(mesh("gfx/models/portraits/biogenesis/bio_01_portrait_01_f_01.mesh"));
    const shipped = replacing();
    shipped.asset("gfx/models/portraits/biogenesis/bio_01_portrait_01_f_01.mesh", new Uint8Array());

    // The game reads none of its own files from there, so the mesh is gone.
    expect(reported(replacing(), "missing-file")).toEqual(["sts_mesh"]);
    expect(reported(shipped, "missing-file")).toEqual([]);
  });

  it("looks for an animation beside the file that declares it", () => {
    const animation = define(
      "model_animation",
      "sts_idle_animation",
      { file: "sts_idle.anim" },
      { file: "portraits/sts/sts_animations.asset" },
    );
    const missing = mod().add(animation);
    const beside = mod().add(animation);
    beside.asset("gfx/models/portraits/sts/sts_idle.anim", new Uint8Array());
    const elsewhere = mod().add(animation);
    elsewhere.asset("gfx/models/sts_idle.anim", new Uint8Array());

    expect(messages(missing, "missing-file")[0]).toContain("gfx/models/portraits/sts/sts_idle.anim");
    expect(reported(beside, "missing-file")).toEqual([]);
    expect(reported(elsewhere, "missing-file")).toEqual(["sts_idle_animation.file"]);
  });

  it("draws a building from the file of its icon, or of its own name", () => {
    const building = (body: Record<string, unknown>) =>
      mod().add(define("building", "sts_lab", { category: "research", building_sets: ["research"], ...body }));

    expect(reported(building({}), "missing-file")).toEqual(["sts_lab"]);
    // A sprite's name is not a file's.
    expect(reported(building({ icon: "GFX_building_physics_lab" }), "missing-file")).toEqual(["sts_lab.icon"]);
    expect(reported(building({ icon: "building_research_lab_1" }), "missing-file")).toEqual([]);
    expect(
      reported(
        mod().add(define("building", "sts_lab", { building_sets: ["research"], icon: "building_research_lab_1" })),
        "missing-category",
      ),
    ).toEqual(["sts_lab"]);
  });
});

/**
 * A state of an entity plays one of its mesh's own animation ids
 * (`0xf79700`, `pdx_entity.cpp:251` and `:266`).
 */
describe("the animation a state plays", () => {
  const entity = (animation: string) =>
    define("model_entity", "sts_entity", {
      pdxmesh: "sts_mesh",
      default_state: "idle",
      state: repeated({ name: "idle", animation, looping: true }),
    });
  const animated = define(
    "model_mesh",
    "sts_mesh",
    {
      file: "gfx/models/portraits/biogenesis/bio_01_portrait_01_f_01.mesh",
      animation: repeated({ id: "idle", type: "humanoid_05_female_idle_animation" }),
    },
    { file: "portraits/sts/sts_meshes.gfx" },
  );

  it("has to be an id the mesh declares", () => {
    expect(reported(mod().add(animated).add(entity("idle")), "unknown-animation")).toEqual([]);
    expect(messages(mod().add(animated).add(entity("idle7")), "unknown-animation")[0]).toContain("it declares idle");
    // The id is hashed as written.
    expect(reported(mod().add(animated).add(entity("Idle")), "unknown-animation")).toEqual(["sts_entity.state"]);
  });

  it("cannot be played by a mesh that declares none", () => {
    const still = define(
      "model_mesh",
      "sts_mesh",
      { file: "gfx/models/portraits/biogenesis/bio_01_portrait_01_f_01.mesh" },
      { file: "portraits/sts/sts_meshes.gfx" },
    );

    expect(messages(mod().add(still).add(entity("idle")), "unknown-animation")[0]).toContain(
      "does not have an animated mesh",
    );
  });

  it("reads an animation written with raw(), and says nothing of a mesh it cannot read", () => {
    const written = (animation: ReturnType<typeof raw>) =>
      define(
        "model_mesh",
        "sts_mesh",
        { file: "gfx/models/portraits/biogenesis/bio_01_portrait_01_f_01.mesh", animation },
        { file: "portraits/sts/sts_meshes.gfx" },
      );
    const parsed = written(raw("{ id = idle type = humanoid_05_female_idle_animation }"));
    const unreadable = written(raw("{ id = idle"));

    expect(reported(mod().add(parsed).add(entity("idle")), "unknown-animation")).toEqual([]);
    expect(messages(mod().add(parsed).add(entity("walk")), "unknown-animation")[0]).toContain("it declares idle");
    // What the mesh declares is not known, which is not the same as nothing.
    expect(reported(mod().add(unreadable).add(entity("walk")), "unknown-animation")).toEqual([]);
  });

  it("looks a mesh up by its own name, whatever every object answers to", () => {
    const target = mod().add(
      define("model_entity", "sts_entity", {
        pdxmesh: "constructor",
        state: repeated({ name: "idle", animation: "idle" }),
      }),
    );

    expect(reported(target, "unknown-animation")).toEqual([]);
    expect(reported(target, "unresolved-reference")).toEqual(["sts_entity"]);
  });

  it("reads the ids of a mesh the base game ships, and of one in the mod's own .gfx", () => {
    const vanilla = (animation: string) =>
      mod().add(
        define("model_entity", "sts_entity", {
          // The base game's: it declares `death3` and `idle`.
          pdxmesh: "abandoned_ship_mesh",
          state: repeated({ name: "idle", animation }),
        }),
      );
    const ownGfx = mod().add(entity("walk"));
    ownGfx.file({
      path: "gfx/models/portraits/sts/sts_meshes.gfx",
      contents:
        'objectTypes = {\n\tpdxmesh = {\n\t\tname = "sts_mesh"\n\t\tfile = "gfx/models/x.mesh"\n\t\tanimation = { id = "walk" type = "x" }\n\t}\n}\n',
    });

    expect(reported(vanilla("idle"), "unknown-animation")).toEqual([]);
    expect(reported(vanilla("sts_no_such_id"), "unknown-animation")).toEqual(["sts_entity.state"]);
    expect(reported(ownGfx, "unknown-animation")).toEqual([]);
  });
});

/**
 * The keys a definition takes are the ones its reader in the executable
 * switches on; any other is an `Unexpected token` in the log.
 */
describe("the keys the game's readers take", () => {
  it("accepts a key a reader takes that the base game never writes", () => {
    const target = mod().add(
      define("building", "sts_lab", {
        category: "research",
        building_sets: ["research"],
        icon: "building_research_lab_1",
        icon_frame: 2,
      }),
    );

    expect(reported(target, "unknown-field")).toEqual([]);
  });

  it("rejects a key no reader takes", () => {
    const trait = mod().add(define("trait", "sts_trait", { cost: 1, destiny_trait: true }));

    expect(reported(trait, "unknown-field")).toEqual(["sts_trait"]);
  });

  it("reads the stages of a situation, each written under its own name", () => {
    const situation = (stage: Record<string, unknown>) =>
      mod().add(
        define("situation_type", "sts_situation", {
          picture: "GFX_evt_mining_station",
          start_value: 0,
          monthly_progress: { base: 1 },
          stages: { sts_stage: { end: 100, ...stage } },
        }),
      );

    expect(reported(situation({ color: "white", section_weight: 5 }), "unknown-field")).toEqual([]);
    expect(reported(situation({ potential: { always: true } }), "unknown-field")).toEqual([
      "sts_situation.stages.sts_stage",
    ]);
    expect(reported(situation({ no_such_key: true }), "unknown-field")).toEqual(["sts_situation.stages.sts_stage"]);
  });
});

/** The listings of the base game are plain objects, and a mod's names are its own. */
describe("names every object answers to", () => {
  it("can be the directory of a mod's file", () => {
    const target = mod().add(define("building", "sts_lab", { category: "research", building_sets: ["research"] }));
    target.file({ path: "constructor/toString.txt", contents: "a = 1\n" });
    target.asset("gfx/interface/icons/buildings/sts_lab.dds", new Uint8Array());

    expect(() => validate(target)).not.toThrow();
    expect(() => emit(target)).not.toThrow();
  });
});
