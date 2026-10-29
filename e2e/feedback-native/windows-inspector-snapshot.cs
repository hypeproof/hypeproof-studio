// Read-only hosted-test snapshots. No process handles, arguments or executable names escape.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
public static class OwnedInspectorSnapshot {
  public const int MaxBytes=1048576, MaxRows=16384, MaxListeners=64;
  public sealed class Failure : Exception {
    public readonly string Stage; public readonly uint Code;
    public Failure(string stage,uint code=0):base("owned_snapshot_"+stage){Stage=stage;Code=code;}
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  private struct ProcessEntry {
    public uint dwSize,cntUsage,th32ProcessID; public UIntPtr th32DefaultHeapID;
    public uint th32ModuleID,cntThreads,th32ParentProcessID;public int pcPriClassBase;public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string szExeFile;
  }
  public sealed class ParentRow { public uint ProcessId,ParentProcessId; }
  public sealed class Snapshot {
    public string schema="hps-owned-windows-listener/1";public int port;
    public uint[] listeners;public ParentRow[] parents;
  }
  [DllImport("iphlpapi.dll",ExactSpelling=true)]
  private static extern uint GetExtendedTcpTable(IntPtr table,ref uint size,[MarshalAs(UnmanagedType.Bool)]bool ordered,uint family,int tableClass,uint reserved);
  [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
  private static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
  [return:MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
  private static void Port(int port){if(port<1024||port>65535)throw new Failure("port");}
  // Same parser consumes the actual OS bytes and portable synthetic controls.
  public static uint[] ParseListeners(byte[] bytes,uint used,int port){
    Port(port);
    if(!BitConverter.IsLittleEndian||bytes==null||used<4||used>MaxBytes||used>bytes.Length)throw new Failure("tcp_length");
    uint count=BitConverter.ToUInt32(bytes,0);
    // Six DWORDs per MIB_TCPROW_OWNER_PID; reject count/length before indexing.
    if(count>MaxRows||4UL+24UL*count>used)throw new Failure("tcp_rows");
    var pids=new SortedSet<uint>();
    for(uint i=0;i<count;i++){
      int offset=checked(4+(int)i*24);uint state=BitConverter.ToUInt32(bytes,offset);
      uint address=BitConverter.ToUInt32(bytes,offset+4),networkPort=BitConverter.ToUInt32(bytes,offset+8);
      int localPort=(int)(((networkPort&255)<<8)|((networkPort>>8)&255));
      if(state!=2||address!=0x0100007f||localPort!=port)continue;
      uint pid=BitConverter.ToUInt32(bytes,offset+20);if(pid<=1)throw new Failure("listener_pid");
      pids.Add(pid);if(pids.Count>MaxListeners)throw new Failure("listener_bound");
    }
    var result=new uint[pids.Count];pids.CopyTo(result);return result;
  }
  // Only fixed phases and elapsed milliseconds escape; no OS strings or process data.
  public static void WritePhase(string nonce,string stage,long elapsedMs){
    if(nonce==null||!Regex.IsMatch(nonce,"^[a-f0-9]{32}$")||elapsedMs<0||elapsedMs>int.MaxValue)throw new Failure("phase_input");
    switch(stage){
      case "tcp_size_started": case "tcp_size_finished": case "tcp_read_started": case "tcp_read_finished":
      case "process_snapshot_started": case "process_snapshot_finished": case "process_enumeration_started": case "process_enumeration_finished": break;
      default: throw new Failure("phase_input");
    }
    Console.Error.WriteLine("HPS_OWNED_SNAPSHOT_PHASE/1|"+nonce+"|"+stage+"|"+elapsedMs.ToString(CultureInfo.InvariantCulture));
    Console.Error.Flush();
  }
  private sealed class PhaseClock {
    private readonly string nonce;private readonly long offset;private readonly Stopwatch clock=Stopwatch.StartNew();
    public PhaseClock(string value,long elapsedMs){nonce=value;offset=elapsedMs;}
    public void Mark(string stage){WritePhase(nonce,stage,checked(offset+clock.ElapsedMilliseconds));}
  }
  private static uint[] Listeners(int port,PhaseClock phase){
    uint size=0;
    // AF_INET=2, TCP_TABLE_OWNER_PID_LISTENER=3. One sizing call, one read; no growth retry.
    phase.Mark("tcp_size_started");
    uint code=GetExtendedTcpTable(IntPtr.Zero,ref size,false,2,3,0);
    phase.Mark("tcp_size_finished");
    if(code!=122)throw new Failure("tcp_size",code);
    if(size<4||size>MaxBytes)throw new Failure("tcp_size_bound");
    uint allocated=size;IntPtr buffer=Marshal.AllocHGlobal(checked((int)allocated));
    try{
      phase.Mark("tcp_read_started");
      code=GetExtendedTcpTable(buffer,ref size,false,2,3,0);
      phase.Mark("tcp_read_finished");
      if(code!=0)throw new Failure("tcp_read",code);
      if(size<4||size>allocated)throw new Failure("tcp_growth");
      byte[] bytes=new byte[size];Marshal.Copy(buffer,bytes,0,checked((int)size));return ParseListeners(bytes,size,port);
    }finally{Marshal.FreeHGlobal(buffer);}
  }
  public static void RequireEnumerationEnd(int code){if(code!=18)throw new Failure("process_enumeration",unchecked((uint)code));}
  private static ParentRow[] Parents(PhaseClock phase){
    phase.Mark("process_snapshot_started");
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0); // TH32CS_SNAPPROCESS only.
    if(snapshot==new IntPtr(-1))throw new Failure("process_snapshot",unchecked((uint)Marshal.GetLastWin32Error()));
    try{
      phase.Mark("process_snapshot_finished");
      var rows=new List<ParentRow>();var seen=new HashSet<uint>();
      var entry=new ProcessEntry();entry.dwSize=checked((uint)Marshal.SizeOf(typeof(ProcessEntry)));
      phase.Mark("process_enumeration_started");
      bool present=Process32FirstW(snapshot,ref entry);
      while(present){
        if(rows.Count>=MaxRows||!seen.Add(entry.th32ProcessID))throw new Failure("process_rows");
        rows.Add(new ParentRow{ProcessId=entry.th32ProcessID,ParentProcessId=entry.th32ParentProcessID});
        present=Process32NextW(snapshot,ref entry);
      }
      int end=Marshal.GetLastWin32Error();
      phase.Mark("process_enumeration_finished");
      RequireEnumerationEnd(end);return rows.ToArray();
    }finally{CloseHandle(snapshot);}
  }
  public static Snapshot Read(int port,string nonce,long elapsedMs){Port(port);var phase=new PhaseClock(nonce,elapsedMs);var listeners=Listeners(port,phase);return new Snapshot{port=port,listeners=listeners,parents=Parents(phase)};}
}
