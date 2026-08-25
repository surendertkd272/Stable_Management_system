#include "LinuxToolKitDemo.h"
#include <unistd.h>

void LoginCallBack(const char* pResponseStr, bool bLoginSuccess, void* pContext)
{
	cout << "[LoginCallBack] " << pResponseStr << endl;
}
void LogoutCallBack(const char* pResponseStr, bool bLogoutSuccess, void* pContext)
{
	cout << "[LogoutCallBack] " << pResponseStr << endl;
}
void DeviceSNCallBack(const char* pDeviceSN, void* pContext)
{
	cout << "[CALLBACK] DeviceSNCallBack" << endl;
}
void DeviceNameCallBack(const char* pDeviceName, void* pContext)
{
	cout << "[CALLBACK] DeviceNameCallBack" << endl;
}
void DeviceModelCallBack(const char* pDeviceModelName, void* pContext)
{
	cout << "[CALLBACK] DeviceModelCallBack" << endl;
}
void DeviceModuleCallBack(const char* pModuleType, _CAMERA_TYPE CameraType, void* pContext)
{
	cout << "[CALLBACK] DeviceModuleCallBack" << endl;
}
void DeviceSensorCallBack(unsigned short ResolutionX, unsigned short ResolutionY, _CAMERA_TYPE CameraType, void* pContext)
{
	cout << "[CALLBACK] DeviceSensorCallBack" << endl;
}
void DeviceFirmWareCallBack(const char* pFirmWareVer, const char* pFirmWareDate, void* pContext)
{
	cout << "[CALLBACK] DeviceFirmWareCallBack" << endl;
}
void DeviceStateCallBack(bool bRecording, bool bAlarmActive, void* pContext)
{
	cout << "[CALLBACK] DeviceStateCallBack" << endl;
}
void DeviceAbilityCallBack(unsigned int SupportMask, void* pContext)
{
	cout << "[CALLBACK] DeviceAbilityCallBack" << endl;
}
void NetWorkBasicParamCallBack(const char* pIPAddress, const char* pNetMask, const char* pGateway, const char* pMacAddress, void* pContext)
{
	cout << "[CALLBACK] NetWorkBasicParamCallBack" << endl;
}
void NetWorkExtParamCallBack(const char* pDNSAddress, const char* pDNSAddress2, bool bDHCPEnable, bool bMulticastEnable, void* pContext)
{
	cout << "[CALLBACK] NetWorkExtParamCallBack" << endl;
}
void NetWorkWifiParamCallBack(const char* pIPAddress, const char* pPassWord, const char* pSSID, bool bDHCPEnable, bool bWIFIEnable, void* pContext)
{
	cout << "[CALLBACK] NetWorkWifiParamCallBack" << endl;
}
void NetWorkFtpParamCallBack(const char* pFtpServerIP, unsigned short FtpPort, const char* pUserName, const char* pPassWord, const char* pStoreDirectory, bool bAnonymityEnable, bool bFTPEnable, void* pContext)
{
	cout << "[CALLBACK] NetWorkFtpParamCallBack" << endl;
}
void NetWorkSmtpParamCallBack(const char* pSmtpServerIP, unsigned short SmtpPort, const char* pUserName, const char* pPassWord, const char* pFromAddr, const char* ReceiptAddr1, const char* ReceiptAddr2, const char* ReceiptAddr3, const char* ReceiptAddr4, bool bSSLEnable, bool bSMTPEnable, void* pContext)
{
	cout << "[CALLBACK] NetWorkSmtpParamCallBack" << endl;
}
void NetWorkHttpsParamCallBack(bool bHttpsEnable, void* pContext)
{
	cout << "[CALLBACK] NetWorkHttpsParamCallBack" << endl;
}
void NetWorkOnvifParamCallBack(unsigned short AuthType, unsigned short OnvifPort, bool bOnvifEnable, void* pContext)
{
	cout << "[CALLBACK] NetWorkOnvifParamCallBack" << endl;
}
void NetWorkGB28181ParamCallBack(const char* pSipServerIP, unsigned short SipServerPort, const char* pServerDomain, const char* pServerSipName, const char* pDeviceSipName, const char* pDeviceSipPSW, unsigned short LocalPort, void* pContext)
{
	cout << "[CALLBACK] NetWorkGB28181ParamCallBack" << endl;
}
void NetWorkGB28181StateCallBack(bool bRegisterStatus, unsigned short SessionExpires, unsigned short HeartBeatTime, unsigned short HeartBeatCount, bool bGB28181Enable, void* pContext)
{
	cout << "[CALLBACK] NetWorkGB28181StateCallBack" << endl;
}
void NetWorkGB28181DVIDCallBack(unsigned short VideoDeviceCounts, const char* pVideoDeviceSipName[], void* pContext)
{
	cout << "[CALLBACK] NetWorkGB28181DVIDCallBack" << endl;
}
void TimeParamCallBack(const char* pTimeZone, const char* pLocalTime, const char* pUpTime, void* pContext)
{
	cout << "[CALLBACK] TimeParamCallBack" << endl;
}
void TimeNtpCallBack(const char* pNtpServerIP, unsigned short NtpPort, unsigned short Interval, bool bNtpEnable, void* pContext)
{
	cout << "[CALLBACK] TimeNtpCallBack" << endl;
}
void ImagePaletteCallBack(unsigned short PaletteID, void* pContext)
{
	cout << "[CALLBACK] ImagePaletteCallBack" << endl;
}
void ImageBasicParamCallBack(_STREAM_TYPE StreamChannelType, const char* pLanguage, bool bMirror, bool bFlip, void* pContext)
{
	cout << "[CALLBACK] ImageBasicParamCallBack" << endl;
}
void ImageEnhanceParamCallBack(_STREAM_TYPE StreamChannelType, unsigned int EnhanceType, bool bAutoMode, unsigned char Value, void* pContext)
{
	cout << "[CALLBACK] ImageEnhanceParamCallBack" << endl;
}
void RtspStreamAddressCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, const char* pRTSPStreamAddress, void* pContext)
{
	cout << "[CALLBACK] RtspStreamAddressCallBack" << endl;
}
void HttpStreamAddressCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, const char* pFLVStreamAddress, void* pContext)
{
	cout << "[CALLBACK] HttpStreamAddressCallBack" << endl;
}
void VideoEncoderParamCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, unsigned short EncodeResolutionX, unsigned short EncodeResolutionY, unsigned short EncodeFrameRate, void* pContext)
{
	cout << "[CALLBACK] VideoEncoderParamCallBack" << endl;
}
void VideoDefaultOSDCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, const char* pDisplayContent, bool bEnable, void* pContext)
{
	cout << "[CALLBACK] VideoDefaultOSDCallBack" << endl;
}
void VideoDateTimeOSDCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, _MeasurePos_XY PosXY, bool bEnable, void* pContext)
{
	cout << "[CALLBACK] VideoDateTimeOSDCallBack" << endl;
}
void VideoCustomOSDCallBack(_STREAM_TYPE StreamChannelType, bool bSubStream, unsigned short DisplayContentCounts, _MeasurePos_XY DisplayContentPosXY[], const char* pDisplayContent[], void* pContext)
{
	cout << "[CALLBACK] VideoCustomOSDCallBack" << endl;
}
void UartExParamCallBack(unsigned int BaudRate, unsigned char DataBits, unsigned char StopBits, unsigned char Parity, void* pContext)
{
	cout << "[CALLBACK] UartExParamCallBack" << endl;
}
void LensCtrlParamCallBack(unsigned char CameraZoom, bool bIRCutOn, _CAMERA_TYPE CameraType, void* pContext)
{
	cout << "[CALLBACK] LensCtrlParamCallBack" << endl;
}
void PTZAngleParamCallBack(int HAngleX100, int VAngleX100, void* pContext)
{
	cout << "[CALLBACK] PTZAngleParamCallBack" << endl;
}
void PTZPresetNumCallBack(unsigned short PresetCounts, void* pContext)
{
	cout << "[CALLBACK] PTZPresetNumCallBack" << endl;
}
void PTZPresetInfoCallBack(unsigned short PresetID, const char* pPresetName, bool bEnable, void* pContext)
{
	cout << "[CALLBACK] PTZPresetInfoCallBack" << endl;
}
void PTZPresetEndCallBack(void* pContext)
{
	cout << "[CALLBACK] PTZPresetEndCallBack" << endl;
}
void MeasureRangeParamCallBack(unsigned short MeasureRange, void* pContext)
{
	cout << "[CALLBACK] MeasureRangeParamCallBack" << endl;
}
void MeasureParamCallBack(short SurroundTemp, unsigned short AimHimidity, unsigned short AimDistance, unsigned short Emissivity100, void* pContext)
{
	cout << "[CALLBACK] MeasureParamCallBack" << endl;
}
void PointMeasureParamCallBack(unsigned short PresetID, unsigned short PointCounts, unsigned short PointIDArray[], _MeasurePos_XY PosXYArray[], unsigned short FPara100Array[], unsigned short AimDistanceArray[], void* pContext)
{
	cout << "[CALLBACK] PointMeasureParamCallBack" << endl;
}
void LineMeasureParamCallBack(unsigned short PresetID, unsigned short LineCounts, unsigned short LineIDArray[], _MeasurePos_XY PosXY1Array[], _MeasurePos_XY PosXY2Array[], unsigned short FPara100Array[], unsigned short AimDistanceArray[], void* pContext)
{
	cout << "[CALLBACK] LineMeasureParamCallBack" << endl;
}
void AreaMeasureParamNumCallBack(unsigned short PresetID, unsigned short AreaCounts, void* pContext)
{
	cout << "[CALLBACK] AreaMeasureParamNumCallBack" << endl;
}
void AreaMeasureParamCallBack(unsigned short PresetID, unsigned short AreaID, unsigned short XYCounts, _MeasurePos_XY PosXYArray[], unsigned short FPara100, unsigned short AimDistance, void* pContext)
{
	cout << "[CALLBACK] AreaMeasureParamCallBack" << endl;
}
void AreaMeasureParamEndCallBack(unsigned short PresetID, void* pContext)
{
	cout << "[CALLBACK] AreaMeasureParamEndCallBack" << endl;
}
void ThermometryPointNumCallBack(unsigned short PresetID, unsigned short PointCounts, void* pContext)
{
	cout << "[CALLBACK] ThermometryPointNumCallBack" << endl;
}
void ThermometryPointCallBack(unsigned short PresetID, unsigned short PointID, _MeasurePos_XY PosXY, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryPointCallBack" << endl;
}
void ThermometryPointEndCallBack(unsigned short PresetID, void* pContext)
{
	cout << "[CALLBACK] ThermometryPointEndCallBack" << endl;
}
void ThermometryLineNumCallBack(unsigned short PresetID, unsigned short LineCounts, void* pContext)
{
	cout << "[CALLBACK] ThermometryLineNumCallBack" << endl;
}
void ThermometryLineMaxCallBack(unsigned short PresetID, unsigned short LineID, _MeasurePos_XY PosXY, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryLineMaxCallBack" << endl;
}
void ThermometryLineAvgCallBack(unsigned short PresetID, unsigned short LineID, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryLineAvgCallBack" << endl;
}
void ThermometryLineMinCallBack(unsigned short PresetID, unsigned short LineID, _MeasurePos_XY PosXY, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryLineMinCallBack" << endl;
}
void ThermometryLineEndCallBack(unsigned short PresetID, void* pContext)
{
	cout << "[CALLBACK] ThermometryLineEndCallBack" << endl;
}
void ThermometryAreaNumCallBack(unsigned short PresetID, unsigned short AreaCounts, void* pContext)
{
	cout << "[CALLBACK] ThermometryAreaNumCallBack" << endl;
}
void ThermometryAreaMaxCallBack(unsigned short PresetID, unsigned short AreaID, _MeasurePos_XY PosXY, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryAreaMaxCallBack" << endl;
}
void ThermometryAreaAvgCallBack(unsigned short PresetID, unsigned short AreaID, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryAreaAvgCallBack" << endl;
}
void ThermometryAreaMinCallBack(unsigned short PresetID, unsigned short AreaID, _MeasurePos_XY PosXY, int ValueX10, void* pContext)
{
	cout << "[CALLBACK] ThermometryAreaMinCallBack" << endl;
}
void ThermometryAreaEndCallBack(unsigned short PresetID, void* pContext)
{
	cout << "[CALLBACK] ThermometryAreaEndCallBack" << endl;
}
void MMCStorageParamCallBack(unsigned short MMCStatus, const char* pTotalSize, const char* pAvailableSize, unsigned short FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bStorageEnable, void* pContext)
{
	cout << "[CALLBACK] MMCStorageParamCallBack" << endl;
}
void NASStorageParamCallBack(unsigned short NASStatus, const char* pTotalSize, const char* pAvailableSize, unsigned short FullGrade, bool bFullAlarmEnable, bool bOverWriteEnable, bool bNASEnable, void* pContext)
{
	cout << "[CALLBACK] NASStorageParamCallBack" << endl;
}
void StorageFileNumCallBack(unsigned int FileCounts, void* pContext)
{
	cout << "[CALLBACK] StorageFileNumCallBack" << endl;
}
void StorageFileInfoCallBack(unsigned int FileSizeBytes, const char* pFileName, void* pContext)
{
	cout << "[CALLBACK] StorageFileInfoCallBack" << endl;
}
void StorageFileEndCallBack(void* pContext)
{
	cout << "[CALLBACK] StorageFileEndCallBack" << endl;
}
void MediaFileDownLoadCallBack(_MEDIA_REC_SRC_ MediaRecType, _MEDIA_FILE_TYPE_ MediaFileType, _MEDIA_FORMAT_TYPE_ FileFormatType, _STREAM_TYPE StreamChannelType, const char* pFilePathName, unsigned int MediaLengthBytes, void* pMediaDataBuffer, void* pContext)
{
	cout << "[CALLBACK] MediaFileDownLoadCallBack" << endl;
}


int main()
{
	//-----------------------------------------------C++ style---------------------------------------------//

	CSDKDemo* pSDKDemo = new CSDKDemo("192.168.171.113", 80, "admin", "Admin123");
	pSDKDemo->QueryTest();
	pSDKDemo->MeasureTest();	
	delete pSDKDemo;
	//-----------------------------------------------C++ style---------------------------------------------//

	//-----------------------------------------------C style-----------------------------------------------//
	/*
	void * pDriver = CreateDMControlDriver();
	OpenDevice(pDriver, LoginCallBack, LogoutCallBack, "192.168.171.113", 80, "admin", "Admin123");	

	QueryDeviceSN(pDriver, DeviceSNCallBack);
	QueryDeviceName(pDriver, DeviceNameCallBack);
	QueryDeviceModel(pDriver, DeviceModelCallBack);
	QueryDeviceModule(pDriver, DeviceModuleCallBack);
	QueryDeviceSensor(pDriver, DeviceSensorCallBack);
	QueryDeviceState(pDriver, DeviceStateCallBack);
	QueryDeviceFirmWare(pDriver, DeviceFirmWareCallBack);
	QueryDeviceAbility(pDriver, DeviceAbilityCallBack);
	QueryNetWorkBasicParam(pDriver, NetWorkBasicParamCallBack);
	QueryNetWorkExtParam(pDriver, NetWorkExtParamCallBack);
	QueryNetWorkWifiParam(pDriver, NetWorkWifiParamCallBack);
	QueryNetWorkFtpParam(pDriver, NetWorkFtpParamCallBack);
	QueryNetWorkSmtpParam(pDriver, NetWorkSmtpParamCallBack);
	QueryNetWorkHttpsParam(pDriver, NetWorkHttpsParamCallBack);
	QueryNetWorkOnvifParam(pDriver, NetWorkOnvifParamCallBack);
	QueryNetWorkGB28181Param(pDriver, NetWorkGB28181ParamCallBack);
	QueryNetWorkGB28181State(pDriver, NetWorkGB28181StateCallBack);
	QueryNetWorkGB28181DVID(pDriver, NetWorkGB28181DVIDCallBack);
	QueryVideoEncoderParam(pDriver, VideoEncoderParamCallBack, STREAM_IR, false);
	QueryVideoEncoderParam(pDriver, VideoEncoderParamCallBack, STREAM_CCD, false);
	sleep(3);

	SetPointMeasure(pDriver, 0, true, 50, 100);
	SetPointMeasure(pDriver, 1, true, 100, 50);
	SetPointMeasure(pDriver, 2, true, 50, 100);
	SetPointMeasure(pDriver, 3, true, 75, 120);
	SetPointMeasure(pDriver, 4, true, 120, 230);
	SetPointMeasure(pDriver, 5, true, 234, 300);

	SetLineMeasure(pDriver, 0, true, 0, 0, 200, 200);
	SetLineMeasure(pDriver, 1, true, 10, 10, 300, 150);
	SetLineMeasure(pDriver, 2, true, 100, 5, 150, 200);
	SetAreaMeasure(pDriver, 0, true, 80, 80, 90, 90);
	SetAreaMeasure(pDriver, 1, true, 80, 80, 100, 190);

	_ScreenPixPos_XY ScreenPixPosXY[5] = { 0 };
	ScreenPixPosXY[0].PosX = 50; ScreenPixPosXY[0].PosY = 50;
	ScreenPixPosXY[1].PosX = 400; ScreenPixPosXY[1].PosY = 50;
	ScreenPixPosXY[2].PosX = 350; ScreenPixPosXY[2].PosY = 100;
	ScreenPixPosXY[3].PosX = 260; ScreenPixPosXY[3].PosY = 250;
	ScreenPixPosXY[4].PosX = 160; ScreenPixPosXY[4].PosY = 150;
	SetAreaPolygonPosMeasureEx(pDriver, 2, true, 5, ScreenPixPosXY, 90, 90);
	sleep(3);

	unsigned int Seconds = 0;
	while (Seconds<30)
	{		
		if (!QueryThermometryPoint(pDriver, ThermometryPointNumCallBack, ThermometryPointCallBack, ThermometryPointEndCallBack))
		{
			break;
		}

		if (!QueryThermometryLine(pDriver, ThermometryLineNumCallBack, ThermometryLineMaxCallBack, ThermometryLineAvgCallBack, ThermometryLineMinCallBack, ThermometryLineEndCallBack))
		{
			break;
		}

		if (!QueryThermometryArea(pDriver, ThermometryAreaNumCallBack, ThermometryAreaMaxCallBack, ThermometryAreaAvgCallBack, ThermometryAreaMinCallBack, ThermometryAreaEndCallBack))
		{
			break;
		}

		QueryPointMeasureParam(pDriver, PointMeasureParamCallBack);

		QueryLineMeasureParam(pDriver, LineMeasureParamCallBack);

		QueryAreaMeasureParam(pDriver, AreaMeasureParamNumCallBack, AreaMeasureParamCallBack, AreaMeasureParamEndCallBack);

		QueryPTZAngleParam(pDriver);

		Seconds++;
		sleep(1);
	}

	CloseDevice(pDriver);
	sleep(10);
	DestoryDMControlDriver(pDriver);
	pDriver = NULL;
	*/
	/*--------------------------------------------------------------------------------------------------*/
	return 0;
}
