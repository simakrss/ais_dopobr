using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using AisDopobrWebService;
internal static class MsiTests
{
    private static int checks;
    private static void Check(bool result, string message) { if (!result) throw new Exception(message); checks++; }
    private static void Reject(Action action, string message) { bool rejected = false; try { action(); } catch { rejected = true; } Check(rejected, message); }
    public static int Main(string[] args)
    {
        try {
            var descriptor = new Dictionary<string,object>{{"version","1.7.554"},{"size",2048},{"sha256",new String('a',64)}};
            SignedMsiUpdate.ValidateDescriptor(descriptor);
            foreach (string version in new[]{"1.7", "1.7.554.0", "256.1.2", "1.7.65536", "../setup", ""}) {
                descriptor["version"]=version;
                Reject(()=>SignedMsiUpdate.ValidateDescriptor(descriptor),"Bad version accepted: "+version);
            }
            descriptor["version"]="1.7.554";
            foreach (object size in new object[]{0,-1,16777217,"x"}) {
                descriptor["size"]=size;
                Reject(()=>SignedMsiUpdate.ValidateDescriptor(descriptor),"Bad size accepted");
            }
            descriptor["size"]=2048;
            foreach(string hash in new[]{"../bad",new String('a',63),new String('a',64)+"\n"}) {
                descriptor["sha256"]=hash;
                Reject(()=>SignedMsiUpdate.ValidateDescriptor(descriptor),"Unsafe hash accepted");
            }
            string token=Guid.NewGuid().ToString(); long now=1000000;
            var request=new Dictionary<string,object>{{"version","1.7.554"},{"token",token},{"requestedAt",now}};
            Check(SignedMsiUpdate.RequestMatches(request,token,"1.7.554",now),"Fresh consent rejected");
            Check(!SignedMsiUpdate.RequestMatches(request,token,"1.7.555",now),"Other version consent accepted");
            Check(!SignedMsiUpdate.RequestMatches(request,Guid.NewGuid().ToString(),"1.7.554",now),"Other token consent accepted");
            Check(!SignedMsiUpdate.RequestMatches(request,token,"1.7.554",now+45000),"Expired consent accepted");
            Check(!SignedMsiUpdate.RequestMatches(request,token,"1.7.554",now-1),"Future consent accepted");
            Reject(()=>SignedMsiUpdate.VerifyPublisher(System.Reflection.Assembly.GetExecutingAssembly().Location),"Unsigned executable trusted");
            Reject(()=>SignedMsiUpdate.VerifyPublisher(Path.Combine(Environment.SystemDirectory,"msiexec.exe")),"Microsoft signature accepted as AIS publisher");
            SignedMsiUpdate.AssertProtectedDirectory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"AisDopobrWeb")); checks++;
            Reject(()=>SignedMsiUpdate.AssertProtectedDirectory(Path.GetTempPath()),"User-writable directory trusted");
            if(args.Length>0) { SignedMsiUpdate.VerifyPublisher(args[0]); checks++; }
            if(args.Length>1) {
                string manifest=Path.Combine(Path.GetDirectoryName(args[1]),"latest.json");
                descriptor=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(manifest));
                SignedMsiUpdate.VerifyPackage(args[1],descriptor); checks++;
                string scratch=Path.Combine(Path.GetTempPath(),"ais-msi-tamper-"+Guid.NewGuid().ToString("N")+".msi");
                try {
                    File.Copy(args[1],scratch);
                    // Mutate an authenticated MSI table, not unused compound-file
                    // padding (which Authenticode deliberately does not authenticate).
                    uint database,view;
                    Check(MsiOpenDatabase(scratch,new IntPtr(1),out database)==0,"Open test MSI for mutation");
                    try {
                        Check(MsiDatabaseOpenView(database,"UPDATE `Property` SET `Value`='1.7.999' WHERE `Property`='ProductVersion'",out view)==0,"Open mutation query");
                        try {Check(MsiViewExecute(view,0)==0,"Mutate product version");}finally{MsiCloseHandle(view);}
                        Check(MsiDatabaseCommit(database)==0,"Commit test mutation");
                    }finally{MsiCloseHandle(database);}
                    byte[] changed=File.ReadAllBytes(scratch);
                    Reject(()=>SignedMsiUpdate.VerifyBytes(changed,descriptor),"Tampered bytes accepted");
                    descriptor["size"]=changed.Length;
                    using(var sha=SHA256.Create())descriptor["sha256"]=BitConverter.ToString(sha.ComputeHash(changed)).Replace("-","").ToLowerInvariant();
                    Reject(()=>SignedMsiUpdate.VerifyPackage(scratch,descriptor),"Tampered MSI accepted with matching replacement hash");
                } finally {File.Delete(scratch);}
            }
            Console.WriteLine("PASS: "+checks+" native MSI security checks (no service changes)");return 0;
        } catch(Exception ex) { Console.Error.WriteLine(ex);return 1; }
    }
    [DllImport("msi.dll",CharSet=CharSet.Unicode)]private static extern uint MsiOpenDatabase(string file,IntPtr persist,out uint database);
    [DllImport("msi.dll",CharSet=CharSet.Unicode)]private static extern uint MsiDatabaseOpenView(uint database,string sql,out uint view);
    [DllImport("msi.dll")]private static extern uint MsiViewExecute(uint view,uint record);
    [DllImport("msi.dll")]private static extern uint MsiDatabaseCommit(uint database);
    [DllImport("msi.dll")]private static extern uint MsiCloseHandle(uint handle);
}
