namespace CodeWalkerBridge;

public record ProbeResult(bool Ok, string BridgeVersion, string CodeWalkerCoreVersion);

public record TextureInfo(
    string Name,
    int Width,
    int Height,
    int Depth,
    int Levels,
    string Format,
    int DataBytes,
    string? ExtractedDds
);

public record InspectYtdResult(bool Ok, string? Error, List<TextureInfo>? Textures);

public record BoneInfo(string Name, int Index, int ParentIndex);

public record LodInfo(string Level, bool Present, float Distance);

public record DrawableInfo(
    string Name,
    float[] BoundingBoxMin,
    float[] BoundingBoxMax,
    float[] BoundingCenter,
    float BoundingSphereRadius,
    int BoneCount,
    List<BoneInfo> Bones,
    List<LodInfo> Lods,
    int TotalModelCount,
    int TotalGeometryCount,
    int TotalVertexCount,
    int TotalTriangleCount,
    bool HasEmbeddedTextureDictionary,
    List<string> EmbeddedTextureNames
);

public record InspectYddResult(bool Ok, string? Error, List<DrawableInfo>? Drawables);

public record GenTestYtdResult(bool Ok, string Path, int Bytes);

public record RepairResult(bool Ok, string? Error, string? OutputPath, int InputBytes, int OutputBytes);

public record MeshPart(
    string ShaderName,
    int VertexCount,
    int IndexCount,
    float[] Positions,
    float[] Normals,
    float[] Uv0,
    int[] Indices,
    int[] DominantBoneIndex
);

public record ExportGeometryResult(
    bool Ok,
    string? Error,
    string? DrawableName,
    string? LodUsed,
    List<MeshPart>? Parts
);
