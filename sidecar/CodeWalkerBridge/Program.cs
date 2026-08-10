using System.Text.Json;
using CodeWalkerBridge;

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false,
};

try
{
    if (args.Length == 0)
    {
        WriteError("No command given. Usage: codewalker-bridge <probe|inspect-ytd|inspect-ydd|export-geometry|repair-ytd|repair-ydd|replace-texture|gen-test-ytd|xml-to-ycd|ycd-to-xml|dump-skeleton> [args...]");
        return 1;
    }

    object result = args[0] switch
    {
        "probe" => Commands.Probe(),
        "inspect-ytd" => Commands.InspectYtd(RequireArg(args, 1, "path"), OptionalOption(args, "--extract-dir")),
        "inspect-ydd" => Commands.InspectYdd(RequireArg(args, 1, "path")),
        "export-geometry" => Commands.ExportGeometry(
            RequireArg(args, 1, "path"),
            OptionalOption(args, "--drawable"),
            OptionalOption(args, "--lod")
        ),
        "repair-ytd" => Commands.RepairYtd(RequireArg(args, 1, "inputPath"), RequireArg(args, 2, "outputPath")),
        "repair-ydd" => Commands.RepairYdd(RequireArg(args, 1, "inputPath"), RequireArg(args, 2, "outputPath")),
        "replace-texture" => Commands.ReplaceTexture(
            RequireArg(args, 1, "ytdPath"),
            RequireArg(args, 2, "textureName"),
            RequireArg(args, 3, "ddsPath"),
            RequireArg(args, 4, "outputPath")
        ),
        "gen-test-ytd" => Commands.GenTestYtd(RequireArg(args, 1, "outputPath")),
        // Animation (.ycd) support - see fivem-animation-converter/.
        "xml-to-ycd" => Commands.XmlToYcd(
            RequireArg(args, 1, "xmlPath"),
            RequireArg(args, 2, "outputPath")
        ),
        "ycd-to-xml" => Commands.YcdToXml(
            RequireArg(args, 1, "ycdPath"),
            RequireArg(args, 2, "outputPath")
        ),
        "dump-skeleton" => Commands.DumpSkeleton(
            RequireArg(args, 1, "path"),
            RequireArg(args, 2, "outputPath")
        ),
        _ => throw new ArgumentException($"Unknown command \"{args[0]}\"."),
    };

    Console.WriteLine(JsonSerializer.Serialize(result, result.GetType(), jsonOptions));
    return 0;
}
catch (Exception ex)
{
    WriteError(ex.Message);
    return 1;
}

void WriteError(string message)
{
    Console.WriteLine(JsonSerializer.Serialize(new ErrorResult(false, message), jsonOptions));
}

string RequireArg(string[] a, int index, string name)
{
    if (index >= a.Length) throw new ArgumentException($"Missing required argument: {name}");
    return a[index];
}

string? OptionalOption(string[] a, string flag)
{
    var idx = Array.IndexOf(a, flag);
    if (idx < 0 || idx + 1 >= a.Length) return null;
    return a[idx + 1];
}

namespace CodeWalkerBridge
{
    public record ErrorResult(bool Ok, string Error);
}
