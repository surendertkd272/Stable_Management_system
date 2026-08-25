
using DotNetToolKitLinux;
using System.Diagnostics;
using System.Runtime.InteropServices;
using static DotNetToolKitLinux.IDMDeviceControl;

namespace DotNetToolKitLinuxDemo
{
    internal class Program
    {
        private readonly IDMDeviceControl pDeviceControl = new DMDeviceControl();
        private String? MediaFileName;

        static void Main(string[] args)
        {
            Console.WriteLine("Press Any Key To Start DotNetToolKitLinuxDemo");
            Console.ReadLine();

            Program program = new Program();
            program.StartTest();
        }

        public void OnLoginCallBack(IntPtr pResponseStr, bool bLoginSuccess, UInt64 pContext)
        {
            Console.WriteLine("[OnLoginCallBack] bLoginSuccess ={0},ResponseStr={1}", bLoginSuccess?"TRUE":"FALSE",Marshal.PtrToStringAuto(pResponseStr));
            if (bLoginSuccess)
            {
                pDeviceControl.QueryDeviceSN(OnDeviceSNCallBack);
                pDeviceControl.QueryDeviceName(OnDeviceNameCallBack);
                pDeviceControl.QueryDeviceModel(OnDeviceModelCallBack);
                pDeviceControl.QueryDeviceModule(OnDeviceModuleCallBack);
                pDeviceControl.QueryDeviceSensor(OnDeviceSensorCallBack);
                pDeviceControl.QueryDeviceState(OnDeviceStateCallBack);
                pDeviceControl.QueryDeviceFirmWare(OnDeviceFirmWareCallBack);
                pDeviceControl.QueryDeviceAbility(OnDeviceAbilityCallBack);
                pDeviceControl.QueryNetWorkBasicParam(OnNetWorkBasicParamCallBack);
                pDeviceControl.QueryNetWorkExtParam(OnNetWorkExtParamCallBack);
                pDeviceControl.QueryNetWorkWifiParam(OnNetWorkWifiParamCallBack);
                pDeviceControl.QueryNetWorkFtpParam(OnNetWorkFtpParamCallBack);
                pDeviceControl.QueryNetWorkSmtpParam(OnNetWorkSmtpParamCallBack);
                pDeviceControl.QueryNetWorkHttpsParam(OnNetWorkHttpsParamCallBack);
                pDeviceControl.QueryNetWorkOnvifParam(OnNetWorkOnvifParamCallBack);
                pDeviceControl.QueryNetWorkGB28181Param(OnNetWorkGB28181ParamCallBack);
                pDeviceControl.QueryNetWorkGB28181State(OnNetWorkGB28181StateCallBack);
                pDeviceControl.QueryNetWorkGB28181DVID(OnNetWorkGB28181DVIDCallBack);
 
                pDeviceControl.QueryTimeParam(OnTimeParamCallBack);
                pDeviceControl.QueryTimeNtp(OnTimeNtpCallBack);
 
                pDeviceControl.QueryImagePalette(OnImagePaletteCallBack);
                pDeviceControl.QueryImageBasicParam(OnImageBasicParamCallBack);
                pDeviceControl.QueryImageEnhanceParam(OnImageEnhanceParamCallBack);
                pDeviceControl.QueryRtspStreamAddress(OnRtspStreamAddressCallBack);
                pDeviceControl.QueryHttpStreamAddress(OnHttpStreamAddressCallBack);
                pDeviceControl.QueryVideoEncoderParam(OnVideoEncoderParamCallBack);
                pDeviceControl.QueryVideoDefaultOSD(OnVideoDefaultOSDCallBack);
                pDeviceControl.QueryVideoCustomOSD(OnVideoCustomOSDCallBack);
                pDeviceControl.QueryVideoDateTimeOSD(OnVideoDateTimeOSDCallBack);
 
                pDeviceControl.QueryUartExParam(OnUartExParamCallBack);
                pDeviceControl.QueryLensCtrlParam(OnLensCtrlParamCallBack);

                pDeviceControl.QueryPTZPresetList(OnPTZPresetNumCallBack, OnPTZPresetInfoCallBack, OnPTZPresetEndCallBack);
                pDeviceControl.QueryMMCStorageParam(OnMMCStorageParamCallBack);
                pDeviceControl.QueryNASStorageParam(OnNASStorageParamCallBack);
                pDeviceControl.QueryMediaList(OnStorageFileNumCallBack, OnStorageFileInfoCallBack, OnStorageFileEndCallBack, "2023-02-20_00:00:00", "2023-02-28_00:00:00", 0, _MEDIA_REC_SRC_._HDD_MEDIA_, _MEDIA_FILE_TYPE_._VIDEO_FILE_, _MEDIA_ATTRIB_TYPE_._ATTRIB_ALL);

                List<_ScreenPixPos_XY> PosXYParams = new List<_ScreenPixPos_XY>();
                PosXYParams.Add(new _ScreenPixPos_XY() { PosX = 50,  PosY = 50, });
                PosXYParams.Add(new _ScreenPixPos_XY() { PosX = 70,  PosY = 70, });
                PosXYParams.Add(new _ScreenPixPos_XY() { PosX = 140, PosY = 175, });
                PosXYParams.Add(new _ScreenPixPos_XY() { PosX = 60,  PosY = 200, });
                PosXYParams.Add(new _ScreenPixPos_XY() { PosX = 30,  PosY = 150, });
                pDeviceControl.SetAreaPolygonPosMeasureEx(1, true, PosXYParams, 97, 100);


                List<_ScreenRatPos_XY> RatXYParams = new List<_ScreenRatPos_XY>();
                RatXYParams.Add(new _ScreenRatPos_XY() { RatX = 5000, RatY = 5000, });
                RatXYParams.Add(new _ScreenRatPos_XY() { RatX = 7000, RatY = 7000, });
                RatXYParams.Add(new _ScreenRatPos_XY() { RatX = 1400,RatY = 1750, });
                RatXYParams.Add(new _ScreenRatPos_XY() { RatX = 6000, RatY = 2000, });
                RatXYParams.Add(new _ScreenRatPos_XY() { RatX = 3000, RatY = 1500, });
                pDeviceControl.SetAreaPolygonRatMeasureEx(2, true, RatXYParams, 97, 100);
                pDeviceControl.QueryAreaMeasureParam(OnAreaMeasureParamNumCallBack, OnAreaMeasureParamCallBack, OnAreaMeasureParamEndCallBack);
                pDeviceControl.QueryThermometryPoint(OnThermometryPointNumCallBack, OnThermometryPointCallBack, OnThermometryPointEndCallBack);
                pDeviceControl.QueryThermometryLine(OnThermometryLineNumCallBack, OnThermometryLineMaxCallBack, OnThermometryLineAvgCallBack, OnThermometryLineMinCallBack, OnThermometryLineEndCallBack);
                pDeviceControl.QueryThermometryArea(OnThermometryAreaNumCallBack, OnThermometryAreaMaxCallBack, OnThermometryAreaAvgCallBack, OnThermometryAreaMinCallBack, OnThermometryAreaEndCallBack);
            }
        }
        public void OnLogoutCallBack(IntPtr pResponseStr, bool bLogoutSuccess, UInt64 pContext)
        {
            Console.WriteLine("[OnLogoutCallBack] ResponseStr={0}", Marshal.PtrToStringAuto(pResponseStr));
        }
         public void OnDeviceSNCallBack(IntPtr pDeviceSN, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceSNCallBack] DeviceSN={0}", Marshal.PtrToStringAuto(pDeviceSN));
        }
        public void OnDeviceNameCallBack(IntPtr pDeviceName, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceNameCallBack] DeviceName={0}", Marshal.PtrToStringAuto(pDeviceName));
        }
        public void OnDeviceModelCallBack(IntPtr pDeviceModelName, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceModelCallBack] DeviceModelName={0}", Marshal.PtrToStringAuto(pDeviceModelName));
        }
        public void OnDeviceModuleCallBack(IntPtr pModuleType, _CAMERA_TYPE CameraType, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceModuleCallBack] ModuleType={0}", Marshal.PtrToStringAuto(pModuleType));
        }
        public void OnDeviceSensorCallBack(UInt16 ResolutionX, UInt16 ResolutionY, _CAMERA_TYPE CameraType, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceSensorCallBack] ResolutionX={0}, ResolutionY={1}, bIRSensor={2}", ResolutionX, ResolutionY, _CAMERA_TYPE.CAMERA_IR == CameraType ? "true":"false");
        }
        public void OnDeviceFirmWareCallBack(IntPtr pFirmWareVer, IntPtr pFirmWareDate, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceFirmWareCallBack] FirmWareVer={0},pFirmWareDate={1}", Marshal.PtrToStringAuto(pFirmWareVer), Marshal.PtrToStringAuto(pFirmWareDate));
        }
        public void OnDeviceStateCallBack(bool bRecording, bool bAlarmActive, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceStateCallBack] bRecording ={0},bAlarmActive = {1}", bRecording?"true":"false", bAlarmActive ? "true" : "false");
        }
        public void OnDeviceAbilityCallBack(UInt32 SupportMask, UInt64 pContext)
        {
            Console.WriteLine("[OnDeviceAbilityCallBack] SUPPORT >>>>>>>>>>>>>>>>>");
            Console.WriteLine("                          SUPPORT_DISTANCEADJUST={0}", (IDMDeviceControl.SUPPORT_DISTANCEADJUST & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_TLUNCH={0}", (IDMDeviceControl.SUPPORT_TLUNCH & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_TDEXT={0}", (IDMDeviceControl.SUPPORT_TDEXT & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_WIFI={0}", (IDMDeviceControl.SUPPORT_WIFI & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_HT10={0}", (IDMDeviceControl.SUPPORT_HT10 & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_GB28181={0}", (IDMDeviceControl.SUPPORT_GB28181 & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_DMMEASURE={0}", (IDMDeviceControl.SUPPORT_DMMEASURE & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_STORAGE={0}", (IDMDeviceControl.SUPPORT_STORAGE & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_IMAGE={0}", (IDMDeviceControl.SUPPORT_IMAGE & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_SHIELD={0}", (IDMDeviceControl.SUPPORT_SHIELD & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_BLACKBODY={0}", (IDMDeviceControl.SUPPORT_BLACKBODY & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_CCD={0}", (IDMDeviceControl.SUPPORT_CCD & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_PTZ={0}", (IDMDeviceControl.SUPPORT_PTZ & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_FACEDETECT={0}", (IDMDeviceControl.SUPPORT_FACEDETECT & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_CLIENTMEASURE={0}", (IDMDeviceControl.SUPPORT_CLIENTMEASURE & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("                          SUPPORT_METARAW={0}", (IDMDeviceControl.SUPPORT_METARAW & SupportMask) > 0 ? ("Yes") : ("No"));
            Console.WriteLine("[OnDeviceAbilityCallBack] SUPPORT <<<<<<<<<<<<<<<<<");
        }
        public void OnNetWorkBasicParamCallBack(IntPtr pIPAddress, IntPtr pNetMask, IntPtr pGateway, IntPtr pMacAddress, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkBasicParamCallBack] IPAddress={0}, NetMask={1}, Gateway={2}, MacAddress={3}", Marshal.PtrToStringAuto(pIPAddress), Marshal.PtrToStringAuto(pNetMask), Marshal.PtrToStringAuto(pGateway), Marshal.PtrToStringAuto(pMacAddress));
        }
        public void OnNetWorkExtParamCallBack(IntPtr pDNSAddress, IntPtr pDNSAddress2, bool bDHCPEnable, bool bMulticastEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkExtParamCallBack] DNSAddress={0}, DNSAddress2={1}, DHCPEnable={2}, MulticastEnable={3}", Marshal.PtrToStringAuto(pDNSAddress), Marshal.PtrToStringAuto(pDNSAddress2), bDHCPEnable, bMulticastEnable?"true":"false");
        }
        public void OnNetWorkWifiParamCallBack(IntPtr pIPAddress, IntPtr pPassWord, IntPtr pSSID, bool bDHCPEnable, bool bWIFIEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkWifiParamCallBack]");
        }
        public void OnNetWorkFtpParamCallBack(IntPtr pFtpServerIP, UInt16 FtpPort, IntPtr pUserName, IntPtr pPassWord, IntPtr pStoreDirectory, bool bAnonymityEnable, bool bFTPEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkFtpParamCallBack]");
        }
        public void OnNetWorkSmtpParamCallBack(IntPtr pSmtpServerIP, UInt16 SmtpPort, IntPtr pUserName, IntPtr pPassWord, IntPtr pFromAddr, IntPtr ReceiptAddr1, IntPtr ReceiptAddr2, IntPtr ReceiptAddr3, IntPtr ReceiptAddr4, bool bSSLEnable, bool bSMTPEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkSmtpParamCallBack]");
        }
        public void OnNetWorkHttpsParamCallBack(bool bHttpsEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkHttpsParamCallBack]");
        }
        public void OnNetWorkOnvifParamCallBack(UInt16 AuthType, UInt16 OnvifPort, bool bOnvifEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkOnvifParamCallBack]");
        }
        public void OnNetWorkGB28181ParamCallBack(IntPtr pSipServerIP, UInt16 SipServerPort, IntPtr pServerDomain, IntPtr pServerSipName, IntPtr pDeviceSipName, IntPtr pDeviceSipPSW, UInt16 LocalPort, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkGB28181ParamCallBack]");
        }
        public void OnNetWorkGB28181StateCallBack(bool bRegisterStatus, UInt16 SessionExpires, UInt16 HeartBeatTime, UInt16 HeartBeatCount, bool bGB28181Enable, UInt64 pContext)
        {
            Console.WriteLine("[OnNetWorkGB28181StateCallBack]");
        }
        public void OnNetWorkGB28181DVIDCallBack(UInt16 VideoDeviceCounts, IntPtr pVideoDeviceSipName, UInt64 pContext)
        {
            Debug.WriteLine("[OnNetWorkGB28181DVIDCallBack] VideoDeviceCounts = {0}", VideoDeviceCounts);
        }
        public void OnTimeParamCallBack(IntPtr pTimeZone, IntPtr pLocalTime, IntPtr pUpTime, UInt64 pContext)
        {
            Console.WriteLine("[OnTimeParamCallBack]");
        }
        public void OnTimeNtpCallBack(IntPtr pNtpServerIP, UInt16 NtpPort, UInt16 Interval, bool bNtpEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnTimeNtpCallBack]");
        }
        public void OnImagePaletteCallBack(UInt16 PaletteID, UInt64 pContext)
        {
            Console.WriteLine("[OnImagePaletteCallBack]");
        }
        public void OnImageBasicParamCallBack(_STREAM_TYPE StreamChannelType, IntPtr pLanguage, bool bMirror, bool bFlip, UInt64 pContext)
        {
            Console.WriteLine("[OnImageBasicParamCallBack]");
        }
        public void OnImageEnhanceParamCallBack(_STREAM_TYPE StreamChannelType, UInt32 EnhanceType, bool bAutoMode, Byte Value, UInt64 pContext)
        {
            Console.WriteLine("[OnImageEnhanceParamCallBack]");
        }
        public void OnRtspStreamAddressCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, IntPtr pRTSPStreamAddress, UInt64 pContext)
        {
            Console.WriteLine("[OnRtspStreamAddressCallBack]");
        }
        public void OnHttpStreamAddressCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, IntPtr pFLVStreamAddress, UInt64 pContext)
        {
            Console.WriteLine("[OnHttpStreamAddressCallBack]");
        }
        public void OnVideoEncoderParamCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, UInt16 EncodeResolutionX, UInt16 EncodeResolutionY, UInt16 EncodeFrameRate, UInt64 pContext)
        {
            Console.WriteLine("[OnVideoEncoderParamCallBack]");
        }
        public void OnVideoDefaultOSDCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, IntPtr pDisplayContent, bool bEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnVideoDefaultOSDCallBack]");
        }
        public void OnVideoDateTimeOSDCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, bool bEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnVideoDateTimeOSDCallBack]");
        }
        public void OnVideoCustomOSDCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, UInt16 DisplayContentCounts, IntPtr DisplayContentPosXY, IntPtr pDisplayContent, UInt64 pContext)
        {
           Debug.WriteLine("[OnVideoCustomOSDCallBack] DisplayContentCounts = {0}", DisplayContentCounts);
        }
        public void OnUartExParamCallBack(UInt32 BaudRate, Byte DataBits, Byte StopBits, Byte Parity, UInt64 pContext)
        {
            Console.WriteLine("[OnUartExParamCallBack]");
        }
        public void OnLensCtrlParamCallBack(Byte CameraZoom, bool bIRCutOn, _CAMERA_TYPE CameraType, UInt64 pContext)
        {
            Console.WriteLine("[OnLensCtrlParamCallBack]");
        }

        public void OnPTZAngleParamDelegate(Int32 HAngle, Int32 VAngle, UInt64 pContext)
        {
            Console.WriteLine("[OnPTZAngleParamDelegate]");
        }

        public void OnPTZPresetNumCallBack(UInt16 PresetCounts, UInt64 pContext)
        {
            Console.WriteLine("[OnPTZPresetNumCallBack]");
        }
        public void OnPTZPresetInfoCallBack(UInt16 PresetID, IntPtr pPresetName, bool bEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnPTZPresetInfoCallBack] PresetID = {0}, pPresetName = {1}, bEnable = {2}", PresetID, Marshal.PtrToStringAuto(pPresetName), bEnable?"true":"false");
        }
        public void OnPTZPresetEndCallBack(UInt64 pContext)
        {
            Console.WriteLine("[OnPTZPresetEndCallBack]");
        }

        public void OnMeasureRangeParamDelegate(UInt16 MeasureRange, UInt64 pContext)
        {
            Console.WriteLine("[OnMeasureRangeParamDelegate]");
        }
        public void OnMeasureParamDelegate(Int16 SurroundTemp, UInt16 AimHimidity, UInt16 AimDistance, UInt16 Emissivity100, UInt64 pContext)
        {
            Console.WriteLine("[OnMeasureParamDelegate]");
        }

        public void OnPointMeasureParamCallBack(UInt16 PresetID, UInt16 Counts, IntPtr PointID, IntPtr PosXY, IntPtr FPara100, IntPtr AimDistance, UInt64 pContext)
        {
            Console.WriteLine("[OnPointMeasureParamCallBack]");
        }

        public void OnLineMeasureParamCallBack(UInt16 PresetID, UInt16 Counts, IntPtr LineID, IntPtr PosXY1, IntPtr PosXY2, IntPtr FPara100, IntPtr AimDistance, UInt64 pContext)
        {
            Console.WriteLine("[OnLineMeasureParamCallBack]");
        }

        public void OnAreaMeasureParamNumCallBack(UInt16 PresetID, UInt16 AreaCounts, UInt64 pContext)
        {
            Console.WriteLine("[OnAreaMeasureParamNumCallBack] AreaCounts = {0}", AreaCounts);
        }

        public void OnAreaMeasureParamCallBack(UInt16 PresetID, UInt16 AreaID, UInt16 XYCounts, IntPtr PosXY, UInt16 FPara100, UInt16 AimDistance, UInt64 pContext)
        {
            Console.WriteLine("[OnAreaMeasureParamCallBack] AreaID = {0}, XYCounts = {1}", AreaID, XYCounts);            
        }
        public void OnAreaMeasureParamEndCallBack(UInt16 PresetID, UInt64 pContext)
        {
            Console.WriteLine("[OnAreaMeasureParamEndCallBack]");
        }

        public void OnThermometryPointNumCallBack(UInt16 PresetID, UInt16 PointCounts, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryPointNumCallBack]");
        }
        public void OnThermometryPointCallBack(UInt16 PresetID, UInt16 PointID, _MeasurePos_XY PosXY, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryPointCallBack] PosX = {0}, PosY = {1}, Value = {2}", PosXY.PosX, PosXY.PosY, ValueX10 / 10.0f);
        }
        public void OnThermometryPointEndCallBack(UInt16 PresetID, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryPointEndCallBack]");
        }
        public void OnThermometryLineNumCallBack(UInt16 PresetID, UInt16 LineCounts, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryLineNumCallBack]");
        }
        public void OnThermometryLineMaxCallBack(UInt16 PresetID, UInt16 LineID, _MeasurePos_XY PosXY, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryLineMaxCallBack] PosX = {0}, PosY = {1}, Value = {2}", PosXY.PosX, PosXY.PosY, ValueX10 / 10.0f);
        }
        public void OnThermometryLineAvgCallBack(UInt16 PresetID, UInt16 LineID, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryLineAvgCallBack] Value = {0}", ValueX10 / 10.0f);
        }
        public void OnThermometryLineMinCallBack(UInt16 PresetID, UInt16 LineID, _MeasurePos_XY PosXY, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryLineMinCallBack] PosX = {0}, PosY = {1}, Value = {2}", PosXY.PosX, PosXY.PosY, ValueX10 / 10.0f);
        }
        public void OnThermometryLineEndCallBack(UInt16 PresetID, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryLineEndCallBack]");
        }
        public void OnThermometryAreaNumCallBack(UInt16 PresetID, UInt16 AreaCounts, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryAreaNumCallBack]");
        }
        public void OnThermometryAreaMaxCallBack(UInt16 PresetID, UInt16 AreaID, _MeasurePos_XY PosXY, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryAreaMaxCallBack] PosX = {0}, PosY = {1}, Value = {2}", PosXY.PosX, PosXY.PosY, ValueX10 / 10.0f);
        }
        public void OnThermometryAreaAvgCallBack(UInt16 PresetID, UInt16 AreaID, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryAreaAvgCallBack] Value = {0}", ValueX10 / 10.0f);
        }
        public void OnThermometryAreaMinCallBack(UInt16 PresetID, UInt16 AreaID, _MeasurePos_XY PosXY, Int16 ValueX10, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryAreaMinCallBack] PosX = {0}, PosY = {1}, Value = {2}", PosXY.PosX, PosXY.PosY, ValueX10/10.0f);
        }
        public void OnThermometryAreaEndCallBack(UInt16 PresetID, UInt64 pContext)
        {
            Console.WriteLine("[OnThermometryAreaEndCallBack]");
        }
        public void OnMMCStorageParamCallBack(UInt16 MMCStatus, IntPtr pTotalSize, IntPtr pAvailableSize, UInt16 FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bStorageEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnMMCStorageParamCallBack]");
        }
        public void OnNASStorageParamCallBack(UInt16 NASStatus, IntPtr pTotalSize, IntPtr pAvailableSize, UInt16 FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bNASEnable, UInt64 pContext)
        {
            Console.WriteLine("[OnNASStorageParamCallBack]");
        }
        public void OnStorageFileNumCallBack(UInt32 FileCounts, UInt64 pContext)
        {
            Console.WriteLine("[OnStorageFileNumCallBack]");
        }
        public void OnStorageFileInfoCallBack(UInt32 FileSizebytes, IntPtr pFileName, UInt64 pContext)
        {
            MediaFileName = Marshal.PtrToStringAuto(pFileName);
            Console.WriteLine("[OnStorageFileInfoCallBack] MediaFile = {0}", MediaFileName);            
        }
        public void OnStorageFileEndCallBack(UInt64 pContext)
        {
            Console.WriteLine("[OnStorageFileEndCallBack]");
        }
        public void OnMediaFileDownLoadCallBack(_MEDIA_REC_SRC_ MediaRecType, _MEDIA_FILE_TYPE_ MediaFileType, _MEDIA_FORMAT_TYPE_ FileFormatType, _STREAM_TYPE StreamChannelType, IntPtr pFilePathName, UInt32 MediaLengthBytes, IntPtr pMediaDataBuffer, UInt64 pContext)
        {
            Console.WriteLine("[OnMediaFileDownLoadCallBack]");
        }

        public void StartTest()
        {
           pDeviceControl.CreateDriverModule();
           pDeviceControl.OpenDevice(OnLoginCallBack, OnLogoutCallBack, "192.168.171.113", 80, "admin", "Admin123");          
           Thread.Sleep(10000);
           pDeviceControl.CloseDevice();
           pDeviceControl.DestoryDMControlDriver();
        }
}
}