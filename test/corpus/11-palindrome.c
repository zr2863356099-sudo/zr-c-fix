#include<stdio.h>
int main(){
    char a[1000];
    while (gets(a))
    {   int i=0,len=0;
        while (a[i]!='\0')//'\0' \别忘记
        {
            len++;
            i++;
        }
        int low=0;
        int flag=1;
        for (int hi=len-1;hi>low ; low++,hi--)//hi不是len
        {
            if(a[low]!=a[hi])
            {flag=0;
            break;}

            

        }
        if (flag)
        {
            printf("yea\n");// 不要忘记换行
        }
        else
        {
            printf("nah\n");
        }

        
        

    }
    return 0;
}