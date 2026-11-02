package com.synthesisone.app

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.view.animation.DecelerateInterpolator
import java.util.Locale
import kotlin.math.abs

class PaymentDonutView(context: Context) : View(context) {
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 28f; strokeCap = Paint.Cap.ROUND }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD }
    private var targetIn = 0.0
    private var targetOut = 0.0
    private var animatedIn = 0.0
    private var animatedOut = 0.0
    private var animatedNet = 0.0
    private var animator: ValueAnimator? = null

    fun setStats(incoming: Double, outgoing: Double, net: Double) {
        targetIn=incoming; targetOut=outgoing
        animator?.cancel()
        val startIn=animatedIn; val startOut=animatedOut; val startNet=animatedNet
        animator=ValueAnimator.ofFloat(0f,1f).apply {
            duration=520; interpolator=DecelerateInterpolator()
            addUpdateListener { v ->
                val f=v.animatedValue as Float
                animatedIn=startIn + (targetIn-startIn)*f
                animatedOut=startOut + (targetOut-startOut)*f
                animatedNet=startNet + (net-startNet)*f
                invalidate()
            }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx=width/2f; val cy=height/2f
        val size=(width.coerceAtMost(height)-42f).coerceAtLeast(100f)
        val rect=RectF(cx-size/2f,cy-size/2f,cx+size/2f,cy+size/2f)
        val total=animatedIn+animatedOut
        ring.strokeWidth=24f
        ring.color=android.graphics.Color.parseColor("#263044")
        canvas.drawArc(rect,-90f,360f,false,ring)
        if(total>0.0) {
            val inSweep=(animatedIn/total*360.0).toFloat()
            ring.color=android.graphics.Color.parseColor("#35E6A5")
            canvas.drawArc(rect,-90f,inSweep,false,ring)
            ring.color=android.graphics.Color.parseColor("#8357FF")
            canvas.drawArc(rect,-90f+inSweep,(360f-inSweep).coerceAtLeast(3f),false,ring)
        }
        text.textSize=11f; text.color=android.graphics.Color.parseColor("#A4ADC5")
        canvas.drawText("NETO",cx,cy-14f,text)
        text.textSize=20f; text.color=if(animatedNet>=0) android.graphics.Color.parseColor("#35E6A5") else android.graphics.Color.parseColor("#FF5C7A")
        val sign=if(animatedNet>=0) "+" else "−"
        canvas.drawText(sign+" %.2f".format(Locale.getDefault(),abs(animatedNet)),cx,cy+13f,text)
        text.textSize=10f; text.color=android.graphics.Color.parseColor("#7D879F")
        canvas.drawText("CUP",cx,cy+31f,text)
    }
}
