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
                new("high", d.FlagsHigh != 0, d.LodDistHigh),
                new("med", d.FlagsMed != 0, d.LodDistMed),
                new("low", d.FlagsLow != 0, d.LodDistLow),
                new("vlow", d.FlagsVlow != 0, d.LodDistVlow),
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
                d.BoundingSphereRadius,
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

    private static float[] Vec3(SharpDX.Vector3 v) => new[] { v.X, v.Y, v.Z };

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
