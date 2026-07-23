using System.Reflection;
using CodeWalker.GameFiles;
using CodeWalker.Utils;

namespace CodeWalkerBridge;

public static class Commands
{
    public static ProbeResult Probe()
    {
        var cwVersion = typeof(YtdFile).Assembly.GetName().Version?.ToString() ?? "unknown";
        var bridgeVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown";
        return new ProbeResult(true, bridgeVersion, cwVersion);
    }

    public static InspectYtdResult InspectYtd(string path, string? extractDir)
    {
        if (!File.Exists(path))
        {
            return new InspectYtdResult(false, $"File not found: {path}", null);
        }

        byte[] data = File.ReadAllBytes(path);
        YtdFile ytd;
        try
        {
            ytd = RpfFile.GetResourceFile<YtdFile>(data);
        }
        catch (Exception ex)
        {
            // A real parse failure here means the file is not a valid RSC7
            // texture dictionary (corrupt / truncated / wrong format) -
            // exactly the kind of structural problem Phase 1's opaque
            // hash-only tracking could never detect.
            return new InspectYtdResult(false, $"Not a valid .ytd resource: {ex.Message}", null);
        }

        if (extractDir != null)
        {
            Directory.CreateDirectory(extractDir);
        }

        var textures = new List<TextureInfo>();
        var items = ytd.TextureDict?.Textures?.data_items ?? Array.Empty<Texture>();
        foreach (var tex in items)
        {
            string? extractedPath = null;
            if (extractDir != null)
            {
                try
                {
                    var dds = DDSIO.GetDDSFile(tex);
                    var fileName = SanitizeFileName(tex.Name) + ".dds";
                    var outPath = Path.Combine(extractDir, fileName);
                    File.WriteAllBytes(outPath, dds);
                    extractedPath = outPath;
                }
                catch (Exception ex)
                {
                    // Don't fail the whole inspection if one texture's pixel data
                    // can't be converted to DDS; report structural info regardless.
                    Console.Error.WriteLine($"Warning: failed to extract DDS for \"{tex.Name}\": {ex.Message}");
                }
            }

            textures.Add(new TextureInfo(
                tex.Name ?? "(unnamed)",
                tex.Width,
                tex.Height,
                tex.Depth,
                tex.Levels,
                tex.Format.ToString(),
                tex.Data?.FullData?.Length ?? 0,
                extractedPath
            ));
        }

        return new InspectYtdResult(true, null, textures);
    }

    public static InspectYddResult InspectYdd(string path)
    {
        if (!File.Exists(path))
        {
            return new InspectYddResult(false, $"File not found: {path}", null);
        }

        byte[] data = File.ReadAllBytes(path);
        YddFile ydd;
        try
        {
            ydd = RpfFile.GetResourceFile<YddFile>(data);
        }
        catch (Exception ex)
        {
            return new InspectYddResult(false, $"Not a valid .ydd resource: {ex.Message}", null);
        }

        var drawables = new List<DrawableInfo>();
        foreach (var d in ydd.Drawables ?? Array.Empty<Drawable>())
        {
            var bones = new List<BoneInfo>();
            var boneArray = d.Skeleton?.BonesSorted;
            if (boneArray != null)
            {
                foreach (var b in boneArray)
                {
                    bones.Add(new BoneInfo(b.Name ?? "(unnamed)", b.Index, b.ParentIndex));
                }
            }

            var lods = new List<LodInfo>
            {
                new("high", d.FlagsHigh != 0, Finite(d.LodDistHigh)),
                new("med", d.FlagsMed != 0, Finite(d.LodDistMed)),
                new("low", d.FlagsLow != 0, Finite(d.LodDistLow)),
                new("vlow", d.FlagsVlow != 0, Finite(d.LodDistVlow)),
            };

            var models = d.AllModels ?? Array.Empty<DrawableModel>();
            int geometryCount = 0, vertexCount = 0, triangleCount = 0;
            foreach (var model in models)
            {
                var geoms = model.Geometries ?? Array.Empty<DrawableGeometry>();
                geometryCount += geoms.Length;
                foreach (var g in geoms)
                {
                    vertexCount += g.VerticesCount;
                    triangleCount += (int)g.TrianglesCount;
                }
            }

            var embeddedTextureNames = new List<string>();
            var embeddedDict = d.ShaderGroup?.TextureDictionary;
            var embeddedTextures = embeddedDict?.Textures?.data_items;
            if (embeddedTextures != null)
            {
                foreach (var t in embeddedTextures) embeddedTextureNames.Add(t.Name ?? "(unnamed)");
            }

            drawables.Add(new DrawableInfo(
                d.Name ?? "(unnamed)",
                Vec3(d.BoundingBoxMin),
                Vec3(d.BoundingBoxMax),
                Vec3(d.BoundingCenter),
                Finite(d.BoundingSphereRadius),
                bones.Count,
                bones,
                lods,
                models.Length,
                geometryCount,
                vertexCount,
                triangleCount,
                embeddedDict != null,
                embeddedTextureNames
            ));
        }

        return new InspectYddResult(true, null, drawables);
    }

    /// <summary>
    /// Extracts real vertex/index geometry (positions, normals, first UV
    /// channel) for the isolated mesh preview (Phase 3). Picks the first
    /// drawable in the file (or the one matching <paramref name="drawableName"/>
    /// if given) and its highest available LOD.
    ///
    /// Uses VertexData.GetVector3/GetVector2 with CodeWalker.GameFiles.VertexSemantics
    /// indices (Position=0, Normal=3, TexCoord0=6) rather than re-deriving the
    /// per-VertexType byte packing ourselves - see docs/FILE_FORMATS.md for why:
    /// this project could not empirically verify the packing scheme against a
    /// real or synthetic fixture (constructing a valid VertexDeclaration by hand
    /// failed - CodeWalker.Core only ever builds one by reading real file bytes),
    /// so it calls the library's own accessors on real, file-loaded data instead
    /// of reimplementing them. Absent semantics (e.g. no second UV channel)
    /// read back as zero rather than throwing - confirmed empirically.
    /// </summary>
    public static ExportGeometryResult ExportGeometry(string path, string? drawableName, string? requestedLod = null)
    {
        if (!File.Exists(path))
        {
            return new ExportGeometryResult(false, $"File not found: {path}", null, null, null);
        }

        byte[] data = File.ReadAllBytes(path);
        YddFile ydd;
        try
        {
            ydd = RpfFile.GetResourceFile<YddFile>(data);
        }
        catch (Exception ex)
        {
            return new ExportGeometryResult(false, $"Not a valid .ydd resource: {ex.Message}", null, null, null);
        }

        var drawables = ydd.Drawables ?? Array.Empty<Drawable>();
        var drawable = drawableName != null
            ? Array.Find(drawables, d => d.Name == drawableName)
            : drawables.Length > 0 ? drawables[0] : null;

        if (drawable == null)
        {
            return new ExportGeometryResult(false, "No matching drawable found in this .ydd.", null, null, null);
        }

        var (models, lodUsed) = requestedLod != null
            ? PickExactLod(drawable, requestedLod)
            : PickBestLod(drawable);
        if (models == null || models.Length == 0)
        {
            var message = requestedLod != null
                ? $"Drawable \"{drawable.Name}\" has no geometry at LOD \"{requestedLod}\"."
                : $"Drawable \"{drawable.Name}\" has no geometry at any LOD.";
            return new ExportGeometryResult(false, message, drawable.Name, null, null);
        }

        var parts = new List<MeshPart>();
        foreach (var model in models)
        {
            foreach (var geom in model.Geometries ?? Array.Empty<DrawableGeometry>())
            {
                var vertexData = geom.VertexData;
                if (vertexData == null) continue;

                int vertexCount = geom.VerticesCount;
                var positions = new float[vertexCount * 3];
                var normals = new float[vertexCount * 3];
                var uv0 = new float[vertexCount * 2];
                var dominantBoneIndex = new int[vertexCount];
                var boneIds = geom.BoneIds; // local blend-index -> skeleton bone id, when the geometry is skinned

                for (int v = 0; v < vertexCount; v++)
                {
                    var p = vertexData.GetVector3((int)VertexSemantics.Position, v);
                    positions[v * 3 + 0] = Finite(p.X);
                    positions[v * 3 + 1] = Finite(p.Y);
                    positions[v * 3 + 2] = Finite(p.Z);

                    var n = vertexData.GetVector3((int)VertexSemantics.Normal, v);
                    normals[v * 3 + 0] = Finite(n.X);
                    normals[v * 3 + 1] = Finite(n.Y);
                    normals[v * 3 + 2] = Finite(n.Z);

                    var uv = vertexData.GetVector2((int)VertexSemantics.TexCoord0, v);
                    uv0[v * 2 + 0] = Finite(uv.X);
                    uv0[v * 2 + 1] = Finite(uv.Y);

                    // "Bone assignments" (Phase 4): the local blend index with the
                    // highest blend weight, resolved through the geometry's BoneIds
                    // table to an actual skeleton bone id when present. Best-effort
                    // visualization, not exact skinning reproduction - see
                    // docs/FILE_FORMATS.md for the same caveat that applies to
                    // position/normal/UV extraction above.
                    var weights = vertexData.GetUByte4((int)VertexSemantics.BlendWeights, v);
                    var localIndices = vertexData.GetUByte4((int)VertexSemantics.BlendIndices, v);
                    byte maxWeight = weights.R;
                    byte maxLocalIndex = localIndices.R;
                    if (weights.G > maxWeight) { maxWeight = weights.G; maxLocalIndex = localIndices.G; }
                    if (weights.B > maxWeight) { maxWeight = weights.B; maxLocalIndex = localIndices.B; }
                    if (weights.A > maxWeight) { maxWeight = weights.A; maxLocalIndex = localIndices.A; }
                    dominantBoneIndex[v] = (boneIds != null && maxLocalIndex < boneIds.Length)
                        ? boneIds[maxLocalIndex]
                        : maxLocalIndex;
                }

                var indicesSource = geom.IndexBuffer?.Indices ?? Array.Empty<ushort>();
                var indices = new int[indicesSource.Length];
                for (int i = 0; i < indicesSource.Length; i++) indices[i] = indicesSource[i];

                parts.Add(new MeshPart(
                    geom.Shader?.Name.ToString() ?? "(unknown shader)",
                    vertexCount,
                    indices.Length,
                    positions,
                    normals,
                    uv0,
                    indices,
                    dominantBoneIndex
                ));
            }
        }

        return new ExportGeometryResult(true, null, drawable.Name, lodUsed, parts);
    }

    private static (DrawableModel[]? models, string? lod) PickBestLod(Drawable d)
    {
        var block = d.DrawableModels;
        if (block == null) return (null, null);
        if (block.High is { Length: > 0 }) return (block.High, "high");
        if (block.Med is { Length: > 0 }) return (block.Med, "med");
        if (block.Low is { Length: > 0 }) return (block.Low, "low");
        if (block.VLow is { Length: > 0 }) return (block.VLow, "vlow");
        return (null, null);
    }

    private static (DrawableModel[]? models, string? lod) PickExactLod(Drawable d, string lod)
    {
        var block = d.DrawableModels;
        if (block == null) return (null, null);
        var models = lod.ToLowerInvariant() switch
        {
            "high" => block.High,
            "med" => block.Med,
            "low" => block.Low,
            "vlow" => block.VLow,
            _ => null,
        };
        return models is { Length: > 0 } ? (models, lod.ToLowerInvariant()) : (null, null);
    }

    /// <summary>
    /// Write-back proof (Phase 4): loads a real, already-valid .ytd through
    /// CodeWalker.Core's reader and re-serializes it through the same
    /// library's writer, verifying the result reloads correctly before
    /// returning. Unlike Commands.GenTestYtd (which builds a resource from
    /// scratch, needing every pointer-referenced block wired by hand), this
    /// starts from an object graph CodeWalker.Core populated itself via a
    /// successful Read() - so the harder "build a valid graph" problem is
    /// already solved by construction. Useful standalone (re-normalizing a
    /// file written by a less careful tool) and as the technical foundation
    /// any future content-editing feature would build on.
    /// </summary>
    public static RepairResult RepairYtd(string inputPath, string outputPath)
    {
        if (!File.Exists(inputPath))
        {
            return new RepairResult(false, $"File not found: {inputPath}", null, 0, 0);
        }

        byte[] inputBytes = File.ReadAllBytes(inputPath);
        YtdFile ytd;
        try
        {
            ytd = RpfFile.GetResourceFile<YtdFile>(inputBytes);
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Not a valid .ytd resource: {ex.Message}", null, inputBytes.Length, 0);
        }

        byte[] outputBytes;
        try
        {
            outputBytes = ytd.Save();
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Failed to re-serialize: {ex.Message}", null, inputBytes.Length, 0);
        }

        // Verify before writing anything to disk: the output must itself be
        // loadable and contain the same number of textures as the input.
        YtdFile reloaded;
        try
        {
            reloaded = RpfFile.GetResourceFile<YtdFile>(outputBytes);
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Re-serialized output failed to reload: {ex.Message}", null, inputBytes.Length, 0);
        }

        var originalCount = ytd.TextureDict?.Textures?.data_items?.Length ?? 0;
        var reloadedCount = reloaded.TextureDict?.Textures?.data_items?.Length ?? 0;
        if (originalCount != reloadedCount)
        {
            return new RepairResult(
                false,
                $"Re-serialized output has {reloadedCount} textures, expected {originalCount}. Refusing to write.",
                null,
                inputBytes.Length,
                0
            );
        }

        File.WriteAllBytes(outputPath, outputBytes);
        return new RepairResult(true, null, outputPath, inputBytes.Length, outputBytes.Length);
    }

    /// <summary>Same write-back proof as <see cref="RepairYtd"/>, for .ydd drawable dictionaries.</summary>
    public static RepairResult RepairYdd(string inputPath, string outputPath)
    {
        if (!File.Exists(inputPath))
        {
            return new RepairResult(false, $"File not found: {inputPath}", null, 0, 0);
        }

        byte[] inputBytes = File.ReadAllBytes(inputPath);
        YddFile ydd;
        try
        {
            ydd = RpfFile.GetResourceFile<YddFile>(inputBytes);
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Not a valid .ydd resource: {ex.Message}", null, inputBytes.Length, 0);
        }

        byte[] outputBytes;
        try
        {
            outputBytes = ydd.Save();
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Failed to re-serialize: {ex.Message}", null, inputBytes.Length, 0);
        }

        YddFile reloaded;
        try
        {
            reloaded = RpfFile.GetResourceFile<YddFile>(outputBytes);
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Re-serialized output failed to reload: {ex.Message}", null, inputBytes.Length, 0);
        }

        var originalCount = ydd.Drawables?.Length ?? 0;
        var reloadedCount = reloaded.Drawables?.Length ?? 0;
        if (originalCount != reloadedCount)
        {
            return new RepairResult(
                false,
                $"Re-serialized output has {reloadedCount} drawables, expected {originalCount}. Refusing to write.",
                null,
                inputBytes.Length,
                0
            );
        }

        File.WriteAllBytes(outputPath, outputBytes);
        return new RepairResult(true, null, outputPath, inputBytes.Length, outputBytes.Length);
    }

    /// <summary>
    /// Phase 6: replaces one named texture's pixel data inside a real .ytd
    /// with a new image, loaded through <see cref="RpfFile.GetResourceFile{T}"/>
    /// like <see cref="RepairYtd"/> so the rest of the object graph
    /// (skeleton/shader-group references elsewhere in the pack, other
    /// textures in the same dictionary) stays exactly as CodeWalker.Core
    /// itself wired it. <paramref name="ddsPath"/> is expected to be a
    /// plain, valid DDS file (the Rust side builds one via
    /// texture_encode.rs's uncompressed-A8R8G8B8 writer from a user-edited
    /// image) - <see cref="DDSIO.GetTexture"/> is the same DDS-to-Texture
    /// path CodeWalker's own texture-import feature uses, so this isn't
    /// reimplementing anything CodeWalker.Core doesn't already do for real
    /// DDS files. The original texture's Name/NameHash/Usage/UsageFlags are
    /// preserved so nothing else that references this texture by name
    /// breaks - only the pixel content, dimensions, and format actually
    /// change. Same verify-before-write shape as RepairYtd/RepairYdd.
    /// </summary>
    public static RepairResult ReplaceTexture(string ytdPath, string textureName, string ddsPath, string outputPath)
    {
        if (!File.Exists(ytdPath))
        {
            return new RepairResult(false, $"File not found: {ytdPath}", null, 0, 0);
        }
        if (!File.Exists(ddsPath))
        {
            return new RepairResult(false, $"DDS file not found: {ddsPath}", null, 0, 0);
        }

        byte[] inputBytes = File.ReadAllBytes(ytdPath);
        YtdFile ytd;
        try
        {
            ytd = RpfFile.GetResourceFile<YtdFile>(inputBytes);
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Not a valid .ytd resource: {ex.Message}", null, inputBytes.Length, 0);
        }

        var items = ytd.TextureDict?.Textures?.data_items;
        if (items == null)
        {
            return new RepairResult(false, "This .ytd has no texture dictionary.", null, inputBytes.Length, 0);
        }

        var index = Array.FindIndex(items, t => string.Equals(t.Name, textureName, StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            return new RepairResult(false, $"Texture \"{textureName}\" not found in this .ytd.", null, inputBytes.Length, 0);
        }

        Texture replacement;
        try
        {
            replacement = DDSIO.GetTexture(File.ReadAllBytes(ddsPath));
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Failed to build a texture from the provided DDS: {ex.Message}", null, inputBytes.Length, 0);
        }

        var original = items[index];
        replacement.Name = original.Name;
        replacement.NameHash = original.NameHash;
        replacement.Usage = original.Usage;
        replacement.UsageFlags = original.UsageFlags;
        items[index] = replacement;

        byte[] outputBytes;
        try
        {
            outputBytes = ytd.Save();
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Failed to re-serialize: {ex.Message}", null, inputBytes.Length, 0);
        }

        // Verify before writing: the output must reload, still contain every
        // texture (none dropped), and the replaced one must carry the new
        // dimensions - not just "some texture with this name exists".
        YtdFile reloaded;
        try
        {
            reloaded = RpfFile.GetResourceFile<YtdFile>(outputBytes);
        }
        catch (Exception ex)
        {
            return new RepairResult(false, $"Re-serialized output failed to reload: {ex.Message}", null, inputBytes.Length, 0);
        }

        var reloadedItems = reloaded.TextureDict?.Textures?.data_items ?? Array.Empty<Texture>();
        if (reloadedItems.Length != items.Length)
        {
            return new RepairResult(
                false,
                $"Re-serialized output has {reloadedItems.Length} textures, expected {items.Length}. Refusing to write.",
                null,
                inputBytes.Length,
                0
            );
        }

        var reloadedTex = Array.Find(reloadedItems, t => string.Equals(t.Name, textureName, StringComparison.OrdinalIgnoreCase));
        if (reloadedTex == null || reloadedTex.Width != replacement.Width || reloadedTex.Height != replacement.Height)
        {
            return new RepairResult(
                false,
                "Re-serialized output did not contain the replaced texture with matching dimensions. Refusing to write.",
                null,
                inputBytes.Length,
                0
            );
        }

        File.WriteAllBytes(outputPath, outputBytes);
        return new RepairResult(true, null, outputPath, inputBytes.Length, outputBytes.Length);
    }

    /// <summary>
    /// Dev/test utility: builds a small but real, valid .ytd resource from
    /// scratch (round-tripped through the actual CodeWalker.Core reader on
    /// the way out) - used to generate committed test fixtures for the
    /// Rust-side RSC7 container codec, since no real Rockstar-produced
    /// sample files are available in this project's test environment.
    /// </summary>
    public static GenTestYtdResult GenTestYtd(string outputPath)
    {
        var pixelData = new byte[8];
        for (int i = 0; i < pixelData.Length; i++) pixelData[i] = (byte)(i + 1);

        var tex = new Texture
        {
            Name = "test_diffuse",
            Width = 4,
            Height = 4,
            Depth = 1,
            Stride = 2,
            Format = TextureFormat.D3DFMT_DXT1,
            Levels = 1,
            Data = new TextureData { FullData = pixelData },
        };

        var td = new TextureDictionary
        {
            Textures = new ResourcePointerList64<Texture> { data_items = new[] { tex } },
            TextureNameHashes = new ResourceSimpleList64_uint
            {
                data_items = new[] { JenkHash.GenHash(tex.Name!.ToLowerInvariant()) },
            },
        };

        var ytd = new YtdFile { TextureDict = td };
        byte[] saved = ytd.Save();
        File.WriteAllBytes(outputPath, saved);

        // Sanity check: make sure what we just wrote is actually readable back.
        var reloaded = RpfFile.GetResourceFile<YtdFile>(saved);
        if (reloaded.TextureDict?.Textures?.data_items?.Length != 1)
        {
            throw new InvalidOperationException("Generated fixture failed self-verification on reload.");
        }

        return new GenTestYtdResult(true, outputPath, saved.Length);
    }

    private static float[] Vec3(SharpDX.Vector3 v) => new[] { Finite(v.X), Finite(v.Y), Finite(v.Z) };

    /// <summary>
    /// Some real files produce non-finite floats here (e.g. a degenerate/
    /// empty bounding box computed as min=+Infinity/max=-Infinity when no
    /// vertices ever updated it, or a vertex accessor reading a semantic
    /// that isn't actually present for a given geometry - see the "one
    /// unverified piece" note on <see cref="ExportGeometry"/>). Standard
    /// JSON has no representation for NaN/Infinity at all - System.Text.Json
    /// throws rather than silently emitting an invalid document - and even
    /// if it didn't, passing Infinity/NaN vertex positions to the Three.js
    /// preview would break its bounding-sphere computation. Zero is the
    /// honest "no real data here" value in both cases, not a middle guess.
    /// </summary>
    private static float Finite(float v) => float.IsFinite(v) ? v : 0f;

    private static string SanitizeFileName(string? name)
    {
        var safe = name ?? "texture";
        foreach (var c in Path.GetInvalidFileNameChars())
        {
            safe = safe.Replace(c, '_');
        }
        return safe;
    }
}
