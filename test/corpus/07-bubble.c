#include<stdio.h>
int main(){
    int n;
    scanf("%d",&n);
    int arr[n];
    for (int i=0;i<n;i++)
    {
        scanf("%d",&arr[i]);
    }
    int flag ,hold;
    for (int i = 0; i < n; i++)
    {    int flag=0;
        for(int j=0;j<n-1;j++)
        { if(arr[j]>arr[j+1])
           { hold=arr[j];
            arr[j]=arr[j+1];
            arr[j+1]=hold;
            flag=1;}
        }
        if (flag=0)
        break;
    }
    for (int i = 0; i < n; i++)
    {
        printf("%d",arr[i]);
        if(i<n-1)
        {printf(" ");}
        
    }
    return 0;
    
}